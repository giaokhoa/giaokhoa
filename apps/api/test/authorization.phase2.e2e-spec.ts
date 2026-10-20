import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ImagesService } from '@giaokhoa/application/images/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresImagesRepository } from '@giaokhoa/database/images';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import { users } from '@giaokhoa/database/schema/auth.generated';
import { question, stimuli } from '@giaokhoa/database/schema/questions';
import * as schema from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import type { QuestionCreate } from '@giaokhoa/shared/questions';

const testDatabaseName = `giaokhoa_phase2_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const richDocument = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Nội dung' }] }],
};
let pool: Pool;
let db: Database;
let questions: QuestionsService;
let imagesRepository: PostgresImagesRepository;

function databaseUrl(name: string) {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL required for Phase 2 e2e');
  const url = new URL(value);
  url.pathname = `/${name}`;
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

async function createUser(role: 'user' | 'teacher' = 'teacher') {
  const [created] = await db
    .insert(users)
    .values({
      name: 'actor',
      email: `actor-${randomUUID()}@example.com`,
      role,
    })
    .returning();
  return created;
}

function questionData(status: 'draft' | 'ready' = 'ready', stimulusId?: string): QuestionCreate {
  return {
    status,
    type: 'short_answer',
    content: richDocument,
    solution: { answer: '42' },
    ...(stimulusId ? { stimulusId } : {}),
  };
}

beforeAll(async () => {
  await withAdminConnection((client) => client.query(`CREATE DATABASE "${testDatabaseName}"`));
  pool = new Pool({ connectionString: databaseUrl(testDatabaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  imagesRepository = new PostgresImagesRepository(db);
  const authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
  questions = new QuestionsService(new PostgresQuestionsRepository(db), authorization);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await withAdminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
  );
}, 30_000);

describe('Phase 2 authoring and asset authorization', () => {
  it('denies user authoring and applies role downgrade on the next request', async () => {
    const student = await createUser('user');
    await expect(questions.createQuestion(questionData(), student.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(
      questions.createStimulus({ content: richDocument }, student.id),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    });
    const teacher = await createUser();
    const created = await questions.createQuestion(questionData(), teacher.id);
    expect(created.solution).toEqual({ answer: '42' });
    await db.update(users).set({ role: 'user' }).where(eq(users.id, teacher.id));
    await expect(questions.getQuestion(created.id, teacher.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('isolates Stimulus reads, writes and question references by owner', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await questions.createStimulus({ content: richDocument }, owner.id);
    await expect(questions.getStimulus(created.id, stranger.id)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'stimulus_not_found',
    });
    await expect(
      questions.updateStimulus(created.id, { content: richDocument }, stranger.id),
    ).rejects.toMatchObject({ kind: 'not_found' });
    await expect(questions.deleteStimulus(created.id, stranger.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(
      questions.createQuestion(questionData('draft', created.id), stranger.id),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'stimulus_invalid' });
    const [stored] = await db.select().from(stimuli).where(eq(stimuli.id, created.id));
    expect(stored.createdByUserId).toBe(owner.id);
    await questions.createQuestion(questionData('ready', created.id), owner.id);
    await expect(
      questions.updateStimulus(created.id, { content: richDocument }, owner.id),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'stimulus_in_use' });
  });

  it('denies legacy Stimuli whose ownership cannot be proven', async () => {
    const owner = await createUser();
    const [legacy] = await db.insert(stimuli).values({ content: richDocument }).returning();
    expect(legacy.createdByUserId).toBeNull();
    await expect(questions.getStimulus(legacy.id, owner.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(
      questions.createQuestion(questionData('draft', legacy.id), owner.id),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'stimulus_invalid' });
  });

  it('refuses original and variant binary reads by non-owners before storage access', async () => {
    const owner = await createUser('user');
    const stranger = await createUser('user');
    const original = await imagesRepository.create({
      createdByUserId: owner.id,
      storageKey: `images/originals/${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      originalFilename: 'private.png',
    });
    const variant = await imagesRepository.createVariant({
      imageId: original.id,
      storageKey: `images/derived/${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      filename: 'private-crop.png',
    });
    const storage = { get: vi.fn(async () => ({ body: Buffer.from('abc') })) };
    const service = new ImagesService(imagesRepository, storage as never);
    await expect(service.getImage(original.id, stranger.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(
      service.getImageVariant(original.id, variant.id, stranger.id),
    ).rejects.toMatchObject({ kind: 'not_found' });
    expect(storage.get).not.toHaveBeenCalled();
    await expect(service.getImage(original.id, owner.id)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    await expect(service.getImageVariant(original.id, variant.id, owner.id)).resolves.toMatchObject(
      {
        mimeType: 'image/png',
      },
    );
    expect(storage.get).toHaveBeenCalledTimes(2);
  });
});

describe('Phase 2 migration for historical Stimuli', () => {
  it('backfills only Stimuli whose referencing questions have one owner', async () => {
    const owner = await createUser();
    const other = await createUser();
    const [single, mixed, orphan] = await db
      .insert(stimuli)
      .values([{ content: richDocument }, { content: richDocument }, { content: richDocument }])
      .returning();

    await db.insert(question).values([
      {
        createdByUserId: owner.id,
        stimulusId: single.id,
        type: 'short_answer',
        content: richDocument,
      },
      {
        createdByUserId: owner.id,
        stimulusId: single.id,
        type: 'short_answer',
        content: richDocument,
      },
      {
        createdByUserId: owner.id,
        stimulusId: mixed.id,
        type: 'short_answer',
        content: richDocument,
      },
      {
        createdByUserId: other.id,
        stimulusId: mixed.id,
        type: 'short_answer',
        content: richDocument,
      },
    ]);

    const migration = readFileSync(join(migrationsFolder, '0002_abnormal_iron_monger.sql'), 'utf8');
    const offset = migration.indexOf('UPDATE "stimuli" AS s');
    expect(offset).toBeGreaterThan(-1);
    await pool.query(migration.slice(offset));

    const rows = await db
      .select()
      .from(stimuli)
      .where(inArray(stimuli.id, [single.id, mixed.id, orphan.id]));
    expect(rows.find(({ id }) => id === single.id)?.createdByUserId).toBe(owner.id);
    expect(rows.find(({ id }) => id === mixed.id)?.createdByUserId).toBeNull();
    expect(rows.find(({ id }) => id === orphan.id)?.createdByUserId).toBeNull();
  });
});
