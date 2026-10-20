import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresFilesRepository } from '@giaokhoa/database/files';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { users } from '@giaokhoa/database/schema/auth.generated';
import { authzContexts } from '@giaokhoa/database/schema/authorization';
import { assignmentRecipients, assignments } from '@giaokhoa/database/schema/assignments';
import { classEnrolments, classes } from '@giaokhoa/database/schema/classes';
import { examRevisionQuestions, examRevisions, exams } from '@giaokhoa/database/schema/exams';
import { fileBlobs, fileObjectDeletions, fileUses, files } from '@giaokhoa/database/schema/files';
import {
  question,
  questionBankEntries,
  questionVersions,
  stimuli,
} from '@giaokhoa/database/schema/questions';
import * as schema from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';

const testDatabaseName =
  'gk_files_security_test_' + process.pid + '_' + randomUUID().replaceAll('-', '');
let pool: Pool;
let db: Database;
let repository: PostgresFilesRepository;

function databaseUrl(name: string) {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL required for Files security E2E');
  const url = new URL(value);
  url.pathname = '/' + name;
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

async function createUser() {
  const [user] = await db
    .insert(users)
    .values({
      name: 'file security test',
      email: 'files-' + randomUUID() + '@example.com',
      role: 'teacher',
    })
    .returning();
  return user;
}

function fileData(userId: string, contentHash: string, originalFilename: string) {
  return {
    createdByUserId: userId,
    contentHash,
    storageKey: 'files/' + contentHash,
    mimeType: 'image/png',
    byteSize: 67,
    width: 1,
    height: 1,
    originalFilename,
    parentFileId: null,
  };
}

beforeAll(async () => {
  await withAdminConnection((client) => client.query('CREATE DATABASE "' + testDatabaseName + '"'));
  pool = new Pool({ connectionString: databaseUrl(testDatabaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  repository = new PostgresFilesRepository(db);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await withAdminConnection((client) =>
    client.query('DROP DATABASE IF EXISTS "' + testDatabaseName + '" WITH (FORCE)'),
  );
}, 30_000);

describe('Files storage and authorization invariants', () => {
  it('deduplicates bytes without merging ownership, sources or file placements', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const hash = createHash('sha256').update(randomUUID()).digest('hex');
    const first = await repository.create(fileData(owner.id, hash, 'first.png'));
    const second = await repository.create(fileData(owner.id, hash, 'second.png'));
    const svgHash = createHash('sha256').update(randomUUID()).digest('hex');
    const source = { kind: 'tikz' as const, source: '\\begin{tikzpicture}\\end{tikzpicture}' };
    const svg = await repository.create(
      { ...fileData(owner.id, svgHash, 'diagram.svg'), mimeType: 'image/svg+xml' },
      source,
    );
    expect(first.id).not.toBe(second.id);
    expect(first.storageKey).toBe(second.storageKey);

    const blobs = await db.select().from(fileBlobs).where(eq(fileBlobs.contentHash, hash));
    expect(blobs).toHaveLength(1);
    expect(await repository.findSourceOwned(svg.id, owner.id)).toEqual(source);
    expect(await repository.findSourceOwned(svg.id, stranger.id)).toBeUndefined();
    expect(await repository.findSourceOwned(first.id, owner.id)).toBeUndefined();
    expect(await repository.findSourceOwned(second.id, owner.id)).toBeUndefined();

    // Xóa asset đầu tiên không được xóa bytes khi asset thứ hai còn tham chiếu.
    expect(
      await repository.discardOrphans([{ fileId: first.id, variantFileId: null }], owner.id),
    ).toEqual([]);
    expect(await repository.find(first.id)).toBeUndefined();
    expect(await repository.find(second.id)).toBeDefined();
    expect(await db.select().from(fileObjectDeletions)).toHaveLength(0);

    const deletedKeys = await repository.discardOrphans(
      [{ fileId: second.id, variantFileId: null }],
      owner.id,
    );
    expect(deletedKeys).toEqual([first.storageKey]);
    expect(await db.select().from(fileBlobs).where(eq(fileBlobs.contentHash, hash))).toHaveLength(
      0,
    );
    expect(await db.select().from(fileObjectDeletions)).toMatchObject([
      { storageKey: first.storageKey },
    ]);
  });

  it('never collects a draft that has gained a persistent content placement', async () => {
    const owner = await createUser();
    const hash = createHash('sha256').update(randomUUID()).digest('hex');
    const file = await repository.create(fileData(owner.id, hash, 'in-use.png'));
    const [context] = await db
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, 'user'), eq(authzContexts.resourceKey, owner.id)))
      .limit(1);
    expect(context).toBeDefined();

    const itemId = randomUUID();
    await db.insert(fileUses).values({
      fileId: file.id,
      contextId: context!.id,
      component: 'questions',
      fileArea: 'content',
      itemId,
    });

    // discard dọn draft placement, nhưng content placement ngăn xóa asset.
    expect(
      await repository.discardOrphans([{ fileId: file.id, variantFileId: null }], owner.id),
    ).toEqual([]);
    expect(await repository.queueExpiredOrphans(new Date(Date.now() + 86_400_000))).toEqual({
      processed: 0,
      storageKeys: [],
    });
    expect(await db.select().from(files).where(eq(files.id, file.id))).toHaveLength(1);

    await db
      .delete(fileUses)
      .where(
        and(
          eq(fileUses.fileId, file.id),
          eq(fileUses.component, 'questions'),
          eq(fileUses.fileArea, 'content'),
        ),
      );
    expect(await repository.queueExpiredOrphans(new Date(Date.now() + 86_400_000))).toEqual({
      processed: 1,
      storageKeys: [file.storageKey],
    });
  });
});

describe('Files recipient visibility', () => {
  it('serves an assigned Stimulus content file, not unrelated or guidance-only files', async () => {
    const teacher = await createUser();
    const student = await createUser();
    const now = new Date();
    const primaryHash = createHash('sha256').update(randomUUID()).digest('hex');
    const primary = await repository.create(fileData(teacher.id, primaryHash, 'stimulus.png'));
    const variantHash = createHash('sha256').update(randomUUID()).digest('hex');
    const variant = await repository.createVariant({
      ...fileData(teacher.id, variantHash, 'stimulus-crop.png'),
      parentFileId: primary.id,
    });
    const richImage = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            fileId: primary.id,
            variantFileId: variant.id,
            alt: null,
            title: null,
            width: null,
            height: null,
            align: 'center',
            crop: { x: 0, y: 0, width: 50, height: 50 },
          },
        },
      ],
    };
    const questionContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Câu hỏi' }] }],
    };

    const [stimulus] = await db
      .insert(stimuli)
      .values({
        createdByUserId: teacher.id,
        content: richImage,
      })
      .returning();
    const [entry] = await db
      .insert(questionBankEntries)
      .values({
        createdByUserId: teacher.id,
      })
      .returning();
    const [questionRow] = await db
      .insert(question)
      .values({
        createdByUserId: teacher.id,
        stimulusId: stimulus.id,
        type: 'short_answer',
        content: questionContent,
        solution: { answer: '42' },
      })
      .returning();
    const [version] = await db
      .insert(questionVersions)
      .values({
        questionBankEntryId: entry.id,
        questionId: questionRow.id,
        version: 1,
        status: 'ready',
      })
      .returning();
    const [exam] = await db
      .insert(exams)
      .values({
        title: 'Test file rights',
        createdByUserId: teacher.id,
      })
      .returning();
    const [revision] = await db
      .insert(examRevisions)
      .values({
        examId: exam.id,
        revision: 1,
        title: exam.title,
      })
      .returning();
    await db.insert(examRevisionQuestions).values({
      examRevisionId: revision.id,
      questionVersionId: version.id,
      position: 1,
      questionSnapshot: {
        id: questionRow.id,
        version: 1,
        status: 'ready',
        type: 'short_answer',
        stimulusId: stimulus.id,
        content: questionContent,
        guidance: null,
        solution: { answer: '42' },
      },
    });
    const [classroom] = await db
      .insert(classes)
      .values({
        name: 'Test class',
        createdByUserId: teacher.id,
        joinMode: 'AUTO',
      })
      .returning();
    await db.insert(classEnrolments).values({
      classId: classroom.id,
      userId: student.id,
      status: 'active',
    });
    const [assignment] = await db
      .insert(assignments)
      .values({
        classId: classroom.id,
        examRevisionId: revision.id,
        createdByUserId: teacher.id,
        audienceMode: 'ALL_CLASS',
        status: 'published',
        openAt: new Date(now.getTime() - 60_000),
        closeAt: new Date(now.getTime() + 86_400_000),
      })
      .returning();
    await db.insert(assignmentRecipients).values({
      assignmentId: assignment.id,
      userId: student.id,
      status: 'active',
      source: 'all_class',
    });

    const [context] = await db
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, 'user'), eq(authzContexts.resourceKey, teacher.id)))
      .limit(1);
    await db.insert(fileUses).values({
      fileId: variant.id,
      contextId: context!.id,
      component: 'stimuli',
      fileArea: 'content',
      itemId: stimulus.id,
    });
    expect(await repository.assignedFileClasses(primary.id, variant.id, student.id, now)).toEqual([
      classroom.id,
    ]);
    // Nội dung chỉ gắn crop: student không được tải ảnh gốc có thể chứa thông tin đã che.
    expect(await repository.assignedFileClasses(primary.id, null, student.id, now)).toEqual([]);

    const unrelatedHash = createHash('sha256').update(randomUUID()).digest('hex');
    const unrelated = await repository.create(fileData(teacher.id, unrelatedHash, 'unrelated.png'));
    await db.insert(fileUses).values([
      {
        fileId: unrelated.id,
        contextId: context!.id,
        component: 'stimuli',
        fileArea: 'content',
        itemId: stimulus.id,
      },
      {
        fileId: unrelated.id,
        contextId: context!.id,
        component: 'questions',
        fileArea: 'guidance',
        itemId: questionRow.id,
      },
    ]);
    expect(await repository.assignedFileClasses(unrelated.id, null, student.id, now)).toEqual([]);

    await db
      .update(assignmentRecipients)
      .set({
        status: 'revoked',
        revokedAt: now,
      })
      .where(
        and(
          eq(assignmentRecipients.assignmentId, assignment.id),
          eq(assignmentRecipients.userId, student.id),
        ),
      );
    expect(await repository.assignedFileClasses(primary.id, variant.id, student.id, now)).toEqual(
      [],
    );
  });
});
