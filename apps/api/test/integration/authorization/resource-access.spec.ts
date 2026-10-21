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
import { users } from '@giaokhoa/database/schema';
import { stimuli } from '@giaokhoa/database/schema';
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

describe('Quyền biên soạn câu hỏi và truy cập tài nguyên', () => {
  it('không cho người dùng thường biên soạn và áp dụng hạ vai trò ngay ở yêu cầu tiếp theo', async () => {
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

  it('giới hạn đọc, sửa và tham chiếu ngữ liệu theo chủ sở hữu', async () => {
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

  it('từ chối ngữ liệu cũ không xác minh được chủ sở hữu', async () => {
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

  it('chặn đọc tệp gốc và biến thể của người khác trước khi truy cập kho lưu trữ', async () => {
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

describe('Vòng đời phiên bản câu hỏi qua QuestionsService', () => {
  it('tạo phiên bản nháp mới khi đổi nội dung rồi công bố ngay trên phiên bản đó', async () => {
    const user = await createUser('teacher');
    const service = questions;
    const created = await service.createQuestion(questionData('draft'), user.id);

    const edited = await service.updateQuestion(
      created.id,
      { solution: { answer: '7' } },
      created.version,
      user.id,
    );
    expect(edited).toMatchObject({ id: created.id, version: 2, status: 'draft' });

    await expect(
      service.updateQuestion(created.id, { status: 'ready' }, created.version, user.id),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'question_version_conflict' });

    const original = await service.getQuestionVersion(created.id, 1, user.id);
    expect(original).toMatchObject({
      id: created.id,
      version: 1,
      status: 'draft',
      solution: { answer: '42' },
    });

    const published = await service.updateQuestion(created.id, { status: 'ready' }, 2, user.id);
    expect(published).toMatchObject({ id: created.id, version: 2, status: 'ready' });
    const history = await service.listQuestionVersions(created.id, user.id);
    expect(history).toHaveLength(2);
    expect(history).toEqual(
      expect.arrayContaining([
        { version: 1, status: 'draft' },
        { version: 2, status: 'ready' },
      ]),
    );

    const repeated = await service.updateQuestion(created.id, { status: 'ready' }, 2, user.id);
    expect(repeated).toMatchObject({ version: 2, status: 'ready' });
    expect(await service.listQuestionVersions(created.id, user.id)).toHaveLength(2);
  });

  it('giữ phiên bản sẵn sàng cũ khi đổi nội dung và kế thừa trạng thái', async () => {
    const user = await createUser('teacher');
    const service = questions;
    const created = await service.createQuestion(questionData('ready'), user.id);

    const edited = await service.updateQuestion(
      created.id,
      { solution: { answer: '7' } },
      created.version,
      user.id,
    );
    expect(edited).toMatchObject({
      id: created.id,
      version: 2,
      status: 'ready',
      solution: { answer: '7' },
    });

    const original = await service.getQuestionVersion(created.id, 1, user.id);
    expect(original).toMatchObject({
      id: created.id,
      version: 1,
      status: 'ready',
      solution: { answer: '42' },
    });

    const draft = await service.updateQuestion(
      created.id,
      { status: 'draft', solution: { answer: '9' } },
      edited.version,
      user.id,
    );
    expect(draft).toMatchObject({ id: created.id, version: 3, status: 'draft' });
    expect(await service.listQuestionVersions(created.id, user.id)).toHaveLength(3);

    const latestReady = await service.getLatestReadyQuestion(created.id, user.id);
    expect(latestReady).toMatchObject({
      id: created.id,
      version: 2,
      status: 'ready',
      solution: { answer: '7' },
    });
  });

  it('không cho sửa ngữ liệu khi câu hỏi liên quan chuyển từ sẵn sàng sang nháp', async () => {
    const user = await createUser('teacher');
    const service = questions;
    const stimulus = await service.createStimulus(
      {
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ngữ liệu ban đầu' }] }],
        },
      },
      user.id,
    );

    const created = await service.createQuestion(
      { ...questionData('ready'), stimulusId: stimulus.id },
      user.id,
    );
    const changed = await service.updateQuestion(
      created.id,
      { status: 'draft' },
      created.version,
      user.id,
    );
    expect(changed).toMatchObject({ id: created.id, version: 1, status: 'draft' });

    await expect(
      service.updateStimulus(
        stimulus.id,
        {
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ngữ liệu đã sửa' }] }],
          },
        },
        user.id,
      ),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'stimulus_in_use' });
  });
});
