import { grantSystemRole, revokeSystemRole } from '../../helpers/roles.js';
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { FilesService } from '@giaokhoa/application/files/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import { PostgresFilesRepository } from '@giaokhoa/database/files';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import {
  assignmentRecipients,
  assignments,
  authzContexts,
  classEnrolments,
  examRevisionQuestions,
  examRevisions,
  exams,
  fileUses,
  questionVersions,
  users,
} from '@giaokhoa/database/schema';
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
    })
    .returning();
  if (role !== 'user') await grantSystemRole(db, created.id, role);
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
    await revokeSystemRole(db, teacher.id, 'teacher');
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

  it('nối các ngữ cảnh tệp nháp, ngân hàng và ngữ liệu vào cây hệ thống, kể cả bản ghi cũ', async () => {
    const teacher = await createUser();
    const root = await new PostgresAuthorizationRepository(db).findContext({
      kind: 'system',
      resourceKey: 'giaokhoa',
    });
    if (!root) throw new Error('Thiếu ngữ cảnh hệ thống');
    const bank = await questions.createQuestion(questionData(), teacher.id);
    const [bankRow] = await db
      .select({ id: authzContexts.id, parentId: authzContexts.parentId })
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, 'bank'), eq(authzContexts.resourceKey, bank.id)));
    expect(bankRow.parentId).toBe(root.id);
    const imageHash = createHash('sha256').update(randomUUID()).digest('hex');
    const image = await filesRepository.create({
      createdByUserId: teacher.id,
      contentHash: imageHash,
      storageKey: `files/${imageHash}`,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      originalFilename: 'test.png',
      parentFileId: null,
    });
    const [draftUse] = await db
      .select({ contextId: fileUses.contextId })
      .from(fileUses)
      .where(eq(fileUses.fileId, image.id))
      .limit(1);
    const [userContext] = await db
      .select({ id: authzContexts.id, parentId: authzContexts.parentId })
      .from(authzContexts)
      .where(eq(authzContexts.id, draftUse.contextId));
    expect(userContext.parentId).toBe(root.id);
    await db
      .update(authzContexts)
      .set({ parentId: null })
      .where(eq(authzContexts.id, userContext.id));
    const repairHash = createHash('sha256').update(randomUUID()).digest('hex');
    await filesRepository.create({
      createdByUserId: teacher.id,
      contentHash: repairHash,
      storageKey: `files/${repairHash}`,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      originalFilename: 'repair.png',
      parentFileId: null,
    });
    const repaired = await new PostgresAuthorizationRepository(db).findContext({
      kind: 'user',
      resourceKey: teacher.id,
    });
    expect(repaired?.parentId).toBe(root.id);
  });

  it('tệp một câu hỏi ở hai bài giao được kiểm từng hoạt động với PROHIBIT riêng', async () => {
    const teacher = await createUser();
    const student = await createUser('user');
    const classroom = await new PostgresClassesRepository(db).create(
      { name: `Lớp ảnh-${randomUUID()}`, joinMode: 'AUTO' },
      teacher.id,
    );
    const classContext = await new PostgresAuthorizationRepository(db).findContext({
      kind: 'class',
      resourceKey: classroom.id,
    });
    if (!classContext) throw new Error('Thiếu ngữ cảnh lớp');
    await db
      .insert(classEnrolments)
      .values({ classId: classroom.id, userId: student.id, status: 'active' });
    const repository = new PostgresAuthorizationRepository(db);
    await repository.assignRole({
      contextId: classContext.id,
      userId: student.id,
      roleKey: 'class:student',
      source: 'class_enrolment',
    });
    const hash = createHash('sha256').update(randomUUID()).digest('hex');
    const image = await filesRepository.create({
      createdByUserId: teacher.id,
      contentHash: hash,
      storageKey: `files/${hash}`,
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      originalFilename: 'anh.png',
      parentFileId: null,
    });
    const imageDoc = {
      type: 'doc' as const,
      content: [
        {
          type: 'image' as const,
          attrs: {
            fileId: image.id,
            variantFileId: null,
            alt: null,
            title: null,
            width: null,
            height: null,
            align: 'center' as const,
            crop: null,
          },
        },
      ],
    };
    const createdQuestion = await questions.createQuestion(
      {
        status: 'ready',
        type: 'short_answer',
        content: imageDoc,
        solution: { answer: '42' },
      },
      teacher.id,
    );
    const [version] = await db
      .select({ id: questionVersions.id })
      .from(questionVersions)
      .where(eq(questionVersions.questionBankEntryId, createdQuestion.id))
      .limit(1);
    const [exam] = await db
      .insert(exams)
      .values({
        title: 'Đề có ảnh',
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
      questionSnapshot: createdQuestion,
    });
    const createAssignment = async () => {
      const [assignment] = await db
        .insert(assignments)
        .values({
          classId: classroom.id,
          examRevisionId: revision.id,
          createdByUserId: teacher.id,
          audienceMode: 'ALL_CLASS',
          status: 'published',
          openAt: new Date(Date.now() - 60_000),
          closeAt: new Date(Date.now() + 86_400_000),
        })
        .returning();
      await db.insert(assignmentRecipients).values({
        assignmentId: assignment.id,
        userId: student.id,
        status: 'active',
        source: 'all_class',
      });
      const [context] = await db
        .insert(authzContexts)
        .values({
          kind: 'assignment',
          resourceKey: assignment.id,
          parentId: classContext.id,
        })
        .returning();
      return { assignment, context };
    };
    const forbiddenAssignment = await createAssignment();
    const allowedAssignment = await createAssignment();
    const authz = new AuthorizationService(repository);
    const storage = { get: vi.fn(async () => ({ body: Buffer.from('abc') })) };
    const service = new FilesService(filesRepository, storage as never, authz);
    await authz.overrideRole(
      teacher.id,
      forbiddenAssignment.context.id,
      'class:student',
      'assignment:view_assigned',
      'PROHIBIT',
    );
    expect(
      await authz.authorize({
        actorId: student.id,
        capability: 'assignment:view_assigned',
        context: { kind: 'assignment', resourceKey: forbiddenAssignment.assignment.id },
      }),
    ).toMatchObject({ allowed: false, reason: 'prohibited' });
    expect(
      await authz.authorize({
        actorId: student.id,
        capability: 'assignment:view_assigned',
        context: { kind: 'assignment', resourceKey: allowedAssignment.assignment.id },
      }),
    ).toMatchObject({ allowed: true });
    expect(
      (
        await filesRepository.assignedFileAssignments(image.id, null, student.id, new Date())
      ).sort(),
    ).toEqual([forbiddenAssignment.assignment.id, allowedAssignment.assignment.id].sort());
    await expect(service.getFile(image.id, student.id)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    await db
      .update(assignmentRecipients)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(
        and(
          eq(assignmentRecipients.assignmentId, allowedAssignment.assignment.id),
          eq(assignmentRecipients.userId, student.id),
        ),
      );
    await expect(service.getFile(image.id, student.id)).rejects.toMatchObject({
      code: 'file_not_found',
    });
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
