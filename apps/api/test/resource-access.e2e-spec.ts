import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { FilesService } from '@giaokhoa/application/files/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresFilesRepository } from '@giaokhoa/database/files';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import { users } from '@giaokhoa/database/schema/auth.generated';
import { stimuli } from '@giaokhoa/database/schema/questions';
import * as schema from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import type { QuestionCreate } from '@giaokhoa/shared/questions';

const testDatabaseName = `gk_resource_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const richDocument = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Nội dung' }] }],
};
let pool: Pool;
let db: Database;
let questions: QuestionsService;
let filesRepository: PostgresFilesRepository;

function databaseUrl(name: string) {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL required for resource access E2E');
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
  filesRepository = new PostgresFilesRepository(db);
  const authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
  questions = new QuestionsService(new PostgresQuestionsRepository(db), authorization);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await withAdminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
  );
}, 30_000);

describe('Question authoring and asset authorization', () => {
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
    const contentHash = createHash('sha256').update('abc').digest('hex');
    const storageKey = `files/${contentHash.slice(0, 2)}/${contentHash}`;
    const original = await filesRepository.create({
      createdByUserId: owner.id,
      contentHash,
      storageKey,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      originalFilename: 'private.png',
      parentFileId: null,
    });
    const variant = await filesRepository.createVariant({
      createdByUserId: owner.id,
      contentHash,
      storageKey,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      originalFilename: 'private-crop.png',
      parentFileId: original.id,
    });
    const storage = { get: vi.fn(async () => ({ body: Buffer.from('abc') })) };
    const service = new FilesService(
      filesRepository,
      storage as never,
      new AuthorizationService(new PostgresAuthorizationRepository(db)),
    );
    await expect(service.getFile(original.id, stranger.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(service.getVariant(original.id, variant.id, stranger.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(storage.get).not.toHaveBeenCalled();
    await expect(service.getFile(original.id, owner.id)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    await expect(service.getVariant(original.id, variant.id, owner.id)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    expect(storage.get).toHaveBeenCalledTimes(2);
  });
});
