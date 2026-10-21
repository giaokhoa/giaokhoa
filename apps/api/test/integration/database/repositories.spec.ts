import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresFilesRepository } from '@giaokhoa/database/files';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import type { Database } from '@giaokhoa/database/types';
import { fileBlobs, fileObjectDeletions, files, fileUses } from '@giaokhoa/database/schema/files';
import { users } from '@giaokhoa/database/schema/auth.generated';
import * as schema from '@giaokhoa/database/schema';
import {
  question,
  questionBankEntries,
  questionVersions,
  stimuli,
} from '@giaokhoa/database/schema/questions';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import type { QuestionCreate } from '@giaokhoa/shared/questions';
import type { FileRef } from '@giaokhoa/shared/files';
import { QuestionsService } from '@giaokhoa/application/questions/service';

const testDatabaseName = `giaokhoa_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;

let pool: Pool;
let db: Database;
let questionsRepository: PostgresQuestionsRepository;
let filesRepository: PostgresFilesRepository;
let authorization: AuthorizationService;

function databaseUrl(databaseName: string) {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required for repository e2e tests');

  const url = new URL(value);
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

async function createUser(label: string, role: 'user' | 'teacher' | 'admin' = 'user') {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${randomUUID()}@example.com`,
      role,
    })
    .returning();
  return user;
}

function fileMetadata(userId: string, label: string) {
  const contentHash = createHash('sha256').update(`${label}-${randomUUID()}`).digest('hex');
  return {
    createdByUserId: userId,
    contentHash,
    storageKey: `files/${contentHash.slice(0, 2)}/${contentHash}`,
    mimeType: 'image/png',
    byteSize: 1,
    width: 1,
    height: 1,
    originalFilename: `${label}.png`,
  };
}

function fileNode(fileId: string, variantFileId: string | null = null) {
  return {
    type: 'image' as const,
    attrs: {
      fileId,
      variantFileId,
      alt: null,
      title: null,
      width: null,
      height: null,
      align: 'center' as const,
      crop: variantFileId ? { x: 0, y: 0, width: 50, height: 50 } : null,
    },
  };
}

async function createFile(userId: string, label: string) {
  return filesRepository.create({ ...fileMetadata(userId, label), parentFileId: null });
}

async function createVariant(fileId: string, label: string) {
  const parent = await filesRepository.find(fileId);
  if (!parent) throw new Error('File gốc không tồn tại');
  return filesRepository.createVariant({
    ...fileMetadata(parent.createdByUserId, label),
    parentFileId: fileId,
  });
}

function questionData(
  answer = '42',
  status: QuestionCreate['status'] = 'ready',
  refs: FileRef[] = [],
): QuestionCreate {
  return {
    status,
    type: 'short_answer',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Câu hỏi' }] },
        ...refs.map(({ fileId, variantFileId }) => fileNode(fileId, variantFileId)),
      ],
    },
    solution: { answer },
  };
}

beforeAll(async () => {
  await withAdminConnection((client) => client.query(`CREATE DATABASE "${testDatabaseName}"`));

  pool = new Pool({ connectionString: databaseUrl(testDatabaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  questionsRepository = new PostgresQuestionsRepository(db);
  filesRepository = new PostgresFilesRepository(db);
  authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
}, 20_000);

beforeEach(async () => {
  await db.delete(fileUses);
  await db.delete(questionVersions);
  await db.delete(question);
  await db.delete(questionBankEntries);
  await db.delete(stimuli);
  await db.delete(files).where(isNotNull(files.parentFileId));
  await db.delete(files);
  await db.delete(fileBlobs);
  await db.delete(fileObjectDeletions);
  await db.delete(users);
});

afterAll(async () => {
  await pool?.end();
  await withAdminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
  );
}, 20_000);

describe('PostgresQuestionsRepository', () => {
  it('rejects file references owned by another user without persisting the question', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const file = await createFile(owner.id, 'private');
    const refs = [{ fileId: file.id, variantFileId: null }];

    await expect(
      questionsRepository.createQuestion(questionData('42', 'ready', refs), refs, otherUser.id),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_file_reference_invalid' });

    expect(await db.select().from(questionBankEntries)).toHaveLength(0);
  });

  it('preserves file areas for each immutable content version', async () => {
    const user = await createUser('author');
    const first = await createFile(user.id, 'first');
    const second = await createFile(user.id, 'second');
    const firstRefs = [{ fileId: first.id, variantFileId: null }];
    const secondRefs = [{ fileId: second.id, variantFileId: null }];

    const created = await questionsRepository.createQuestion(
      questionData('42', 'draft', firstRefs),
      firstRefs,
      user.id,
    );

    const updated = await questionsRepository.createQuestionVersion(
      created.id,
      created.version,
      questionData('7', 'draft', secondRefs),
      secondRefs,
      user.id,
    );
    expect(updated).toMatchObject({ id: created.id, version: 2, status: 'draft' });

    const revisions = await db
      .select({ version: questionVersions.version, questionId: questionVersions.questionId })
      .from(questionVersions)
      .where(eq(questionVersions.questionBankEntryId, created.id));
    expect(revisions).toHaveLength(2);

    const [attachedFirst] = await db.select().from(files).where(eq(files.id, first.id));
    const [attachedSecond] = await db.select().from(files).where(eq(files.id, second.id));
    const firstUses = await db
      .select({ fileId: fileUses.fileId, area: fileUses.fileArea })
      .from(fileUses)
      .where(eq(fileUses.itemId, revisions.find((row) => row.version === 1)!.questionId));
    const secondUses = await db
      .select({ fileId: fileUses.fileId, area: fileUses.fileArea })
      .from(fileUses)
      .where(eq(fileUses.itemId, revisions.find((row) => row.version === 2)!.questionId));

    expect(attachedFirst.orphanedAt).toBeNull();
    expect(attachedSecond.orphanedAt).toBeNull();
    expect(firstUses).toEqual([{ fileId: first.id, area: 'content' }]);
    expect(secondUses).toEqual([{ fileId: second.id, area: 'content' }]);
  });

  it('changes status without allocating a new version', async () => {
    const user = await createUser('author');
    const created = await questionsRepository.createQuestion(
      questionData('42', 'draft'),
      [],
      user.id,
    );

    const published = await questionsRepository.changeQuestionStatus(
      created.id,
      created.version,
      'ready',
      user.id,
    );
    expect(published).toMatchObject({ id: created.id, version: 1, status: 'ready' });
    expect(await questionsRepository.listQuestionVersions(created.id)).toEqual([
      { version: 1, status: 'ready' },
    ]);

    const repeated = await questionsRepository.changeQuestionStatus(
      created.id,
      created.version,
      'ready',
      user.id,
    );
    expect(repeated).toMatchObject({ id: created.id, version: 1, status: 'ready' });
    expect(await questionsRepository.listQuestionVersions(created.id)).toHaveLength(1);
  });

  it('keeps a file attached while another question version still references it', async () => {
    const user = await createUser('author');
    const file = await createFile(user.id, 'shared');
    const refs = [{ fileId: file.id, variantFileId: null }];
    const first = await questionsRepository.createQuestion(
      questionData('1', 'draft', refs),
      refs,
      user.id,
    );
    await questionsRepository.createQuestion(questionData('2', 'ready', refs), refs, user.id);

    await questionsRepository.createQuestionVersion(
      first.id,
      first.version,
      questionData('3', 'draft'),
      [],
      user.id,
    );

    const [storedFile] = await db.select().from(files).where(eq(files.id, file.id));
    expect(storedFile.orphanedAt).toBeNull();
  });

  it('enforces question ownership for update and delete', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const question = await questionsRepository.createQuestion(questionData(), [], owner.id);

    expect(await questionsRepository.findQuestionOwned(question.id, otherUser.id)).toBeUndefined();
    expect(
      await questionsRepository.createQuestionVersion(
        question.id,
        question.version,
        questionData('7'),
        [],
        otherUser.id,
      ),
    ).toBeUndefined();
    expect(await questionsRepository.deleteQuestion(question.id, otherUser.id)).toBeUndefined();

    expect(await questionsRepository.findQuestionOwned(question.id, owner.id)).toBeDefined();
  });

  it('rejects a crop variant that belongs to a different file', async () => {
    const user = await createUser('author');
    const first = await createFile(user.id, 'first');
    const second = await createFile(user.id, 'second');
    const secondVariant = await createVariant(second.id, 'second-crop');
    const invalidRefs = [{ fileId: first.id, variantFileId: secondVariant.id }];

    await expect(
      questionsRepository.createQuestion(
        questionData('42', 'ready', invalidRefs),
        invalidRefs,
        user.id,
      ),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_file_reference_invalid' });

    expect(await db.select().from(questionBankEntries)).toHaveLength(0);
  });
});

describe('QuestionsService version lifecycle', () => {
  it('creates a new draft version for content changes, then publishes it in place', async () => {
    const user = await createUser('author', 'teacher');
    const service = new QuestionsService(questionsRepository, authorization);
    const created = await service.createQuestion(questionData('42', 'draft'), user.id);

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

  it('preserves a ready version when content changes and inherits its status', async () => {
    const user = await createUser('author', 'teacher');
    const service = new QuestionsService(questionsRepository, authorization);
    const created = await service.createQuestion(questionData('42', 'ready'), user.id);

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

  it('does not let a stimulus change after its question switches from ready to draft', async () => {
    const user = await createUser('author', 'teacher');
    const service = new QuestionsService(questionsRepository, authorization);
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
      { ...questionData('42', 'ready'), stimulusId: stimulus.id },
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

describe('PostgresFilesRepository', () => {
  it('returns generated TikZ source only to its owner', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const metadata = fileMetadata(owner.id, 'diagram');
    const file = await filesRepository.create(
      {
        ...metadata,
        mimeType: 'image/svg+xml',
        width: 100,
        height: 80,
        originalFilename: 'diagram.svg',
        parentFileId: null,
      },
      {
        kind: 'tikz',
        source: String.raw`\\begin{tikzpicture}\\end{tikzpicture}`,
      },
    );

    expect(await filesRepository.findSourceOwned(file.id, owner.id)).toEqual({
      kind: 'tikz',
      source: String.raw`\\begin{tikzpicture}\\end{tikzpicture}`,
    });
    expect(await filesRepository.findSourceOwned(file.id, otherUser.id)).toBeUndefined();
  });

  it('queues unreferenced file and derived variants in the object deletion outbox', async () => {
    const user = await createUser('owner');
    const file = await createFile(user.id, 'orphan');
    const variant = await createVariant(file.id, 'orphan-crop');

    const storageKeys = await filesRepository.discardOrphans(
      [{ fileId: file.id, variantFileId: null }],
      user.id,
    );

    expect(storageKeys).toEqual([variant.storageKey, file.storageKey]);
    expect(await filesRepository.listPendingDeletions()).toEqual([...storageKeys].sort());
    expect(await filesRepository.find(file.id)).toBeUndefined();
  });

  it('preserves a file referenced by a question', async () => {
    const user = await createUser('owner');
    const file = await createFile(user.id, 'referenced');
    const refs = [{ fileId: file.id, variantFileId: null }];
    await questionsRepository.createQuestion(questionData('42', 'ready', refs), refs, user.id);
    const storageKeys = await filesRepository.discardOrphans(refs, user.id);

    expect(storageKeys).toEqual([]);
    expect(await filesRepository.find(file.id)).toBeDefined();
  });

  it('never discards an orphan belonging to another user', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const file = await createFile(owner.id, 'private');
    const storageKeys = await filesRepository.discardOrphans(
      [{ fileId: file.id, variantFileId: null }],
      otherUser.id,
    );

    expect(storageKeys).toEqual([]);
    expect(await filesRepository.find(file.id)).toBeDefined();
  });
});
