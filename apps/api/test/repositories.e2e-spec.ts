import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresImagesRepository } from '@giaokhoa/database/images';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import type { Database } from '@giaokhoa/database/types';
import { imageVariants, images, questionImageRefs } from '@giaokhoa/database/schema/images';
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
import { QuestionsService } from '@giaokhoa/application/questions/service';

const testDatabaseName = `giaokhoa_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;

let pool: Pool;
let db: Database;
let questionsRepository: PostgresQuestionsRepository;
let imagesRepository: PostgresImagesRepository;

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

async function createUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${randomUUID()}@example.com`,
    })
    .returning();
  return user;
}

async function createImage(userId: string, label: string) {
  const [image] = await db
    .insert(images)
    .values({
      createdByUserId: userId,
      storageKey: `images/${label}-${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: 1,
      width: 1,
      height: 1,
      originalFilename: `${label}.png`,
    })
    .returning();
  return image;
}

async function createVariant(imageId: string, label: string) {
  const [variant] = await db
    .insert(imageVariants)
    .values({
      imageId,
      storageKey: `images/derived/${label}-${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: 1,
      width: 1,
      height: 1,
      filename: `${label}.png`,
    })
    .returning();
  return variant;
}

function questionData(answer = '42', status: QuestionCreate['status'] = 'ready'): QuestionCreate {
  return {
    status,
    type: 'short_answer',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Câu hỏi' }] }],
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
  imagesRepository = new PostgresImagesRepository(db);
}, 20_000);

beforeEach(async () => {
  await db.delete(questionImageRefs);
  await db.delete(questionVersions);
  await db.delete(question);
  await db.delete(questionBankEntries);
  await db.delete(stimuli);
  await db.delete(imageVariants);
  await db.delete(images);
  await db.delete(users);
});

afterAll(async () => {
  await pool?.end();
  await withAdminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
  );
}, 20_000);

describe('PostgresQuestionsRepository', () => {
  it('rejects image references owned by another user without persisting the question', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const image = await createImage(owner.id, 'private');

    await expect(
      questionsRepository.createQuestion(
        questionData(),
        [{ imageId: image.id, imageVariantId: null }],
        otherUser.id,
      ),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_image_reference_invalid' });

    expect(await db.select().from(questionBankEntries)).toHaveLength(0);
  });

  it('preserves each version’s images when a draft gets a new content version', async () => {
    const user = await createUser('author');
    const first = await createImage(user.id, 'first');
    const second = await createImage(user.id, 'second');

    const created = await questionsRepository.createQuestion(
      questionData('42', 'draft'),
      [{ imageId: first.id, imageVariantId: null }],
      user.id,
    );

    const updated = await questionsRepository.createQuestionVersion(
      created.id,
      created.version,
      questionData('7', 'draft'),
      [{ imageId: second.id, imageVariantId: null }],
      user.id,
    );
    expect(updated).toMatchObject({ id: created.id, version: 2, status: 'draft' });

    const revisions = await db
      .select({ version: questionVersions.version, questionId: questionVersions.questionId })
      .from(questionVersions)
      .where(eq(questionVersions.questionBankEntryId, created.id));
    expect(revisions).toHaveLength(2);

    const [attachedFirst] = await db.select().from(images).where(eq(images.id, first.id));
    const [attachedSecond] = await db.select().from(images).where(eq(images.id, second.id));
    const firstRefs = await db
      .select({ imageId: questionImageRefs.imageId })
      .from(questionImageRefs)
      .where(
        eq(questionImageRefs.questionId, revisions.find((row) => row.version === 1)!.questionId),
      );
    const secondRefs = await db
      .select({ imageId: questionImageRefs.imageId })
      .from(questionImageRefs)
      .where(
        eq(questionImageRefs.questionId, revisions.find((row) => row.version === 2)!.questionId),
      );

    expect(attachedFirst.orphanedAt).toBeNull();
    expect(attachedSecond.orphanedAt).toBeNull();
    expect(firstRefs).toEqual([{ imageId: first.id }]);
    expect(secondRefs).toEqual([{ imageId: second.id }]);
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

  it('keeps an image attached while another question still references it', async () => {
    const user = await createUser('author');
    const image = await createImage(user.id, 'shared');
    const first = await questionsRepository.createQuestion(
      questionData('1', 'draft'),
      [{ imageId: image.id, imageVariantId: null }],
      user.id,
    );
    await questionsRepository.createQuestion(
      questionData('2'),
      [{ imageId: image.id, imageVariantId: null }],
      user.id,
    );

    await questionsRepository.createQuestionVersion(
      first.id,
      first.version,
      questionData('3', 'draft'),
      [],
      user.id,
    );

    const [storedImage] = await db.select().from(images).where(eq(images.id, image.id));
    expect(storedImage.orphanedAt).toBeNull();
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

  it('rejects a crop variant that belongs to a different image', async () => {
    const user = await createUser('author');
    const first = await createImage(user.id, 'first');
    const second = await createImage(user.id, 'second');
    const secondVariant = await createVariant(second.id, 'second-crop');

    await expect(
      questionsRepository.createQuestion(
        questionData(),
        [{ imageId: first.id, imageVariantId: secondVariant.id }],
        user.id,
      ),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_image_reference_invalid' });

    expect(await db.select().from(questionBankEntries)).toHaveLength(0);
  });
});

describe('QuestionsService version lifecycle', () => {
  it('creates a new draft version for content changes, then publishes it in place', async () => {
    const user = await createUser('author');
    const service = new QuestionsService(questionsRepository);
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
    const user = await createUser('author');
    const service = new QuestionsService(questionsRepository);
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
    const user = await createUser('author');
    const service = new QuestionsService(questionsRepository);
    const stimulus = await service.createStimulus({
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ngữ liệu ban đầu' }] }],
      },
    });

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
      service.updateStimulus(stimulus.id, {
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ngữ liệu đã sửa' }] }],
        },
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'stimulus_in_use' });
  });
});

describe('PostgresImagesRepository', () => {
  it('returns generated source only to the image owner', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const image = await imagesRepository.create(
      {
        createdByUserId: owner.id,
        storageKey: `images/source-${randomUUID()}.svg`,
        mimeType: 'image/svg+xml',
        byteSize: 10,
        width: 100,
        height: 80,
        originalFilename: 'diagram.svg',
      },
      {
        kind: 'tikz',
        source: String.raw`\\begin{tikzpicture}\\end{tikzpicture}`,
      },
    );

    expect(await imagesRepository.findSourceOwned(image.id, owner.id)).toEqual({
      kind: 'tikz',
      source: String.raw`\\begin{tikzpicture}\\end{tikzpicture}`,
    });
    expect(await imagesRepository.findSourceOwned(image.id, otherUser.id)).toBeUndefined();
  });

  it('queues an unreferenced orphan and its derived images for deletion', async () => {
    const user = await createUser('owner');
    const image = await createImage(user.id, 'orphan');
    const variant = await createVariant(image.id, 'orphan-crop');

    const storageKeys = await imagesRepository.discardOrphans(
      [{ imageId: image.id, imageVariantId: null }],
      user.id,
    );

    expect(storageKeys).toEqual([variant.storageKey, image.storageKey]);
    expect(await imagesRepository.listPendingDeletions()).toEqual([...storageKeys].sort());
    expect(await imagesRepository.find(image.id)).toBeUndefined();
  });

  it('keeps an orphan candidate while a question still references it', async () => {
    const user = await createUser('owner');
    const image = await createImage(user.id, 'referenced');
    await questionsRepository.createQuestion(
      questionData(),
      [{ imageId: image.id, imageVariantId: null }],
      user.id,
    );
    const storageKeys = await imagesRepository.discardOrphans(
      [{ imageId: image.id, imageVariantId: null }],
      user.id,
    );

    expect(storageKeys).toEqual([]);
    expect(await imagesRepository.find(image.id)).toBeDefined();
  });

  it("does not discard another user's orphan", async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other');
    const image = await createImage(owner.id, 'private');
    const storageKeys = await imagesRepository.discardOrphans(
      [{ imageId: image.id, imageVariantId: null }],
      otherUser.id,
    );

    expect(storageKeys).toEqual([]);
    expect(await imagesRepository.find(image.id)).toBeDefined();
  });
});
