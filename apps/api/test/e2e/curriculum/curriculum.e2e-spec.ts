import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClientErrorFilter } from '../../../src/common/client-error.filter.js';
import { CurriculumModule } from '../../../src/curriculum/curriculum.module.js';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import * as schema from '@giaokhoa/database/schema';

const testDatabaseName = `giaokhoa_curriculum_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const originalDatabaseUrl = process.env.DATABASE_URL;

function databaseUrl(databaseName: string) {
  if (!originalDatabaseUrl) throw new Error('DATABASE_URL is required for curriculum e2e tests');
  const url = new URL(originalDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withAdminConnection<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl('postgres') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

describe('Curriculum API (e2e)', () => {
  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
    await withAdminConnection((client) => client.query(`CREATE DATABASE "${testDatabaseName}"`));
    process.env.DATABASE_URL = databaseUrl(testDatabaseName);

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });

    const module = await Test.createTestingModule({
      imports: [
        DrizzleModule.forRoot({
          drizzle,
          connection: process.env.DATABASE_URL,
          schema,
        }),
        CurriculumModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ClientErrorFilter },
        { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  }, 20_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await withAdminConnection((client) =>
      client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
    );
  }, 20_000);

  it('supports subject -> curriculum -> nodes -> outcomes CRUD', async () => {
    const subject = await request(app.getHttpServer())
      .post('/subjects')
      .send({ name: 'Toán', slug: 'toan' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .patch(`/subjects/${subject.id}`)
      .send({ position: 2 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.position).toBe(2);
      });

    await request(app.getHttpServer())
      .patch(`/subjects/${subject.id}`)
      .send({ position: 2_147_483_648 })
      .expect(400);

    const curriculum = await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 6 })
      .expect(201)
      .then(({ body }) => body as { id: string; subjectId: string; grade: number });

    await request(app.getHttpServer())
      .get(`/subjects/${subject.id}/curricula`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: curriculum.id,
            subjectId: subject.id,
            grade: 6,
          }),
        ]);
      });

    await request(app.getHttpServer())
      .get(`/subjects/${subject.id}/curricula/6`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            id: curriculum.id,
            subjectId: subject.id,
            grade: 6,
          }),
        );
      });

    const root = await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: curriculum.id, title: 'Số và Đại số', position: 1 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const child = await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({
        curriculumId: curriculum.id,
        parentId: root.id,
        title: 'Số tự nhiên',
        position: 1,
      })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .get(`/curricula/${curriculum.id}/nodes`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: root.id,
            curriculumId: curriculum.id,
            parentId: null,
          }),
          expect.objectContaining({
            id: child.id,
            curriculumId: curriculum.id,
            parentId: root.id,
          }),
        ]);
      });

    const outcome = await request(app.getHttpServer())
      .post('/learning-outcomes')
      .send({ nodeId: child.id, content: 'Nhận biết được số tự nhiên.', position: 1 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .patch(`/learning-outcomes/${outcome.id}`)
      .send({ content: 'Nhận biết và đọc được số tự nhiên.' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('Nhận biết và đọc được số tự nhiên.');
      });

    await request(app.getHttpServer())
      .get(`/curriculum-nodes/${child.id}/outcomes`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ id: outcome.id, nodeId: child.id, position: 1 }),
        ]);
      });

    await request(app.getHttpServer())
      .patch(`/curricula/${curriculum.id}`)
      .send({ grade: 7 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.grade).toBe(7);
      });

    await request(app.getHttpServer())
      .get(`/subjects/${subject.id}/curricula/7`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(curriculum.id);
      });

    await request(app.getHttpServer()).delete(`/curriculum-nodes/${root.id}`).expect(204);
    await request(app.getHttpServer()).get(`/learning-outcomes/${outcome.id}`).expect(404);

    await request(app.getHttpServer()).delete(`/curricula/${curriculum.id}`).expect(204);
    await request(app.getHttpServer()).get(`/curricula/${curriculum.id}`).expect(404);

    await request(app.getHttpServer()).delete(`/subjects/${subject.id}`).expect(204);
    await request(app.getHttpServer()).get(`/subjects/${subject.id}`).expect(404);
  });

  it('rejects a parent from another curriculum', async () => {
    const subject = await request(app.getHttpServer())
      .post('/subjects')
      .send({ name: 'Ngữ văn', slug: 'ngu-van' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const grade6 = await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 6 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const grade7 = await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 7 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const parent = await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: grade6.id, title: 'Đọc', position: 1 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: grade7.id, parentId: parent.id, title: 'Văn bản' })
      .expect(400);

    await expect(
      pool.query(
        'insert into curriculum_nodes (curriculum_id, parent_id, title) values ($1, $2, $3)',
        [grade7.id, parent.id, 'Bypass service'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects duplicate subject and grade curricula', async () => {
    const subject = await request(app.getHttpServer())
      .post('/subjects')
      .send({ name: 'Khoa học tự nhiên', slug: 'khoa-hoc-tu-nhien' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 6 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 6 })
      .expect(409);

    const grade7 = await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 7 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .patch(`/curricula/${grade7.id}`)
      .send({ grade: 6 })
      .expect(409);

    const otherSubject = await request(app.getHttpServer())
      .post('/subjects')
      .send({ name: 'Khoa học', slug: 'khoa-hoc' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .patch(`/subjects/${otherSubject.id}`)
      .send({ slug: 'khoa-hoc-tu-nhien' })
      .expect(409);
  });

  it('maps concurrent unique violations to 409', async () => {
    const subjectResponses = await Promise.all([
      request(app.getHttpServer()).post('/subjects').send({ name: 'Tin học A', slug: 'tin-hoc' }),
      request(app.getHttpServer()).post('/subjects').send({ name: 'Tin học B', slug: 'tin-hoc' }),
    ]);
    expect(subjectResponses.map(({ status }) => status).sort((a, b) => a - b)).toEqual([201, 409]);

    const createdSubject = subjectResponses.find(({ status }) => status === 201);
    if (!createdSubject) throw new Error('Expected one subject creation to succeed');
    const subjectId = (createdSubject.body as { id: string }).id;
    const curriculumResponses = await Promise.all([
      request(app.getHttpServer()).post('/curricula').send({ subjectId, grade: 10 }),
      request(app.getHttpServer()).post('/curricula').send({ subjectId, grade: 10 }),
    ]);
    expect(curriculumResponses.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
  });

  it('serializes concurrent reparenting so a cycle cannot persist', async () => {
    const subject = await request(app.getHttpServer())
      .post('/subjects')
      .send({ name: 'Sinh học', slug: 'sinh-hoc' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const curriculum = await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 10 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const a = await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: curriculum.id, title: 'A' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const b = await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: curriculum.id, title: 'B' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const responses = await Promise.all([
      request(app.getHttpServer()).patch(`/curriculum-nodes/${a.id}`).send({ parentId: b.id }),
      request(app.getHttpServer()).patch(`/curriculum-nodes/${b.id}`).send({ parentId: a.id }),
    ]);
    expect(responses.map(({ status }) => status).sort((a, b) => a - b)).toEqual([200, 400]);

    const [storedA, storedB] = await Promise.all([
      request(app.getHttpServer())
        .get(`/curriculum-nodes/${a.id}`)
        .expect(200)
        .then(({ body }) => body as { parentId: string | null }),
      request(app.getHttpServer())
        .get(`/curriculum-nodes/${b.id}`)
        .expect(200)
        .then(({ body }) => body as { parentId: string | null }),
    ]);
    expect(storedA.parentId === b.id && storedB.parentId === a.id).toBe(false);
  });

  it('rejects positions outside PostgreSQL integer storage', async () => {
    const subject = await request(app.getHttpServer())
      .post('/subjects')
      .send({ name: 'Địa lí', slug: 'dia-li' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    const curriculum = await request(app.getHttpServer())
      .post('/curricula')
      .send({ subjectId: subject.id, grade: 10 })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: curriculum.id, title: 'Địa lí tự nhiên', position: 2_147_483_648 })
      .expect(400);

    const node = await request(app.getHttpServer())
      .post('/curriculum-nodes')
      .send({ curriculumId: curriculum.id, title: 'Địa lí tự nhiên' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .patch(`/curriculum-nodes/${node.id}`)
      .send({ position: 2_147_483_648 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/learning-outcomes')
      .send({ nodeId: node.id, content: 'Yêu cầu cần đạt', position: 2_147_483_648 })
      .expect(400);

    const outcome = await request(app.getHttpServer())
      .post('/learning-outcomes')
      .send({ nodeId: node.id, content: 'Yêu cầu cần đạt' })
      .expect(201)
      .then(({ body }) => body as { id: string });

    await request(app.getHttpServer())
      .patch(`/learning-outcomes/${outcome.id}`)
      .send({ position: 2_147_483_648 })
      .expect(400);
  });
});
