import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AssignmentsService } from '@giaokhoa/application/assignments/service';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClassesService } from '@giaokhoa/application/classes/service';
import { ExamsService } from '@giaokhoa/application/exams/service';
import { FilesService } from '@giaokhoa/application/files/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresAssignmentsRepository } from '@giaokhoa/database/assignments';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import { PostgresExamsRepository } from '@giaokhoa/database/exams';
import { PostgresFilesRepository } from '@giaokhoa/database/files';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import * as schema from '@giaokhoa/database/schema';
import { users } from '@giaokhoa/database/schema/auth.generated';
import {
  assignments as assignmentRows,
  assignmentRecipients,
} from '@giaokhoa/database/schema/assignments';
import type { Database } from '@giaokhoa/database/types';

const name = `gk_recipient_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-10-20T12:00:00.000Z');
const openAt = new Date(now.getTime() - 60_000).toISOString();
const closeAt = new Date(now.getTime() + 3_600_000).toISOString();
const document = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Câu hỏi' }] }],
};
let pool: Pool;
let db: Database;
let assignments: AssignmentsService;
let classes: ClassesService;
let exams: ExamsService;
let questions: QuestionsService;
let authorization: AuthorizationService;

function databaseUrl(database: string) {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL required for assignment recipient E2E');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

async function adminConnection<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl('postgres') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createUser(role: 'teacher' | 'user' | 'admin' = 'user') {
  const [row] = await db
    .insert(users)
    .values({
      name: role,
      email: `${randomUUID()}@example.com`,
      role,
    })
    .returning();
  return row;
}

async function fixture() {
  const teacher = await createUser('teacher');
  const classroom = await classes.createClass(teacher.id, { name: 'Lớp toán', joinMode: 'AUTO' });
  const stimulus = await questions.createStimulus(
    {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Đọc đoạn văn này' }] }],
      },
    },
    teacher.id,
  );
  const question = await questions.createQuestion(
    {
      stimulusId: stimulus.id,
      status: 'ready',
      type: 'short_answer',
      content: document,
      solution: { answer: '42' },
    },
    teacher.id,
  );
  const exam = await exams.createExam(teacher.id, { title: 'Đề riêng của lớp' });
  const revision = await exams.createRevision(teacher.id, exam.id, {
    questions: [{ questionId: question.id, version: question.version }],
  });
  const code = await classes.createJoinCode(teacher.id, classroom.id, { expiresInHours: 24 });
  const join = async (userId: string) => classes.joinClass(userId, code.code);
  const create = (audienceMode: 'ALL_CLASS' | 'SELECTED_USERS', selectedUserIds: string[] = []) =>
    assignments.create(teacher.id, {
      classId: classroom.id,
      examRevisionId: revision.id,
      audienceMode,
      selectedUserIds,
      openAt,
      closeAt,
      maxAttempts: 2,
    });
  return { teacher, classroom, exam, revision, stimulus, join, create };
}

beforeAll(async () => {
  await adminConnection((client) => client.query(`CREATE DATABASE "${name}"`));
  pool = new Pool({ connectionString: databaseUrl(name) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
  assignments = new AssignmentsService(
    new PostgresAssignmentsRepository(db),
    authorization,
    () => now,
  );
  classes = new ClassesService(new PostgresClassesRepository(db), authorization);
  exams = new ExamsService(new PostgresExamsRepository(db), authorization);
  questions = new QuestionsService(new PostgresQuestionsRepository(db), authorization);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await adminConnection((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}, 30_000);

describe('Assignment publication and recipients', () => {
  it('snapshots only active class members and never auto-assigns late joiners', async () => {
    const { teacher, classroom, join, create } = await fixture();
    const first = await createUser();
    const second = await createUser();
    const suspended = await createUser();
    const outsider = await createUser();
    await join(first.id);
    await join(second.id);
    await join(suspended.id);
    await classes.suspendMember(teacher.id, classroom.id, suspended.id);

    const draft = await create('ALL_CLASS');
    await expect(assignments.getDelivery(first.id, draft.id)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_available',
    });
    const published = await assignments.publish(teacher.id, draft.id);
    expect(published.status).toBe('published');
    expect((await assignments.listRecipients(teacher.id, draft.id)).map((r) => r.userId)).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await assignments.getDelivery(first.id, draft.id)).questions).toHaveLength(1);
    await expect(assignments.getDelivery(suspended.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(assignments.getDelivery(outsider.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });

    const late = await createUser();
    await join(late.id);
    await expect(assignments.getDelivery(late.id, draft.id)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_available',
    });
    expect(await assignments.listRecipients(teacher.id, draft.id)).toHaveLength(2);
  });

  it('rejects outsiders and suspended members atomically, then publishes one selected student', async () => {
    const { teacher, classroom, stimulus, join, create } = await fixture();
    const selected = await createUser();
    const otherMember = await createUser();
    const suspended = await createUser();
    const outsider = await createUser();
    await join(selected.id);
    await join(otherMember.id);
    await join(suspended.id);
    await classes.suspendMember(teacher.id, classroom.id, suspended.id);
    const draft = await create('SELECTED_USERS', [selected.id, outsider.id]);
    await expect(assignments.publish(teacher.id, draft.id)).rejects.toMatchObject({
      kind: 'invalid',
      code: 'assignment_recipients_invalid',
    });
    expect(
      await db
        .select()
        .from(assignmentRecipients)
        .where(eq(assignmentRecipients.assignmentId, draft.id)),
    ).toHaveLength(0);
    await assignments.update(teacher.id, draft.id, {
      selectedUserIds: [selected.id, suspended.id],
    });
    await expect(assignments.publish(teacher.id, draft.id)).rejects.toMatchObject({
      kind: 'invalid',
    });
    expect(
      (await db.select().from(assignmentRows).where(eq(assignmentRows.id, draft.id)))[0].status,
    ).toBe('draft');

    await assignments.update(teacher.id, draft.id, { selectedUserIds: [selected.id] });
    await assignments.publish(teacher.id, draft.id);
    await assignments.publish(teacher.id, draft.id);
    expect((await assignments.listRecipients(teacher.id, draft.id)).map((r) => r.userId)).toEqual([
      selected.id,
    ]);
    await expect(assignments.getDelivery(otherMember.id, draft.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    const delivery = await assignments.getDelivery(selected.id, draft.id);
    expect(delivery.questions[0].question).toMatchObject({
      type: 'short_answer',
      stimulusId: stimulus.id,
      stimulus: {
        id: stimulus.id,
        content: { content: [{ content: [{ text: 'Đọc đoạn văn này' }] }] },
      },
    });
    expect(JSON.stringify(delivery)).not.toContain('"solution"');
    expect(JSON.stringify(delivery)).not.toContain('"answer":"42"');
    expect(JSON.stringify(delivery)).not.toContain('"guidance"');

    await assignments.revokeRecipient(teacher.id, draft.id, selected.id);
    await assignments.revokeRecipient(teacher.id, draft.id, selected.id);
    const recipients = await assignments.listRecipients(teacher.id, draft.id);
    expect(recipients[0].status).toBe('revoked');
    expect(recipients[0].revokedAt).toBeInstanceOf(Date);
    await expect(assignments.getDelivery(selected.id, draft.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(
      assignments.update(teacher.id, draft.id, { maxAttempts: 4 }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      code: 'assignment_not_draft',
    });
    expect(await assignments.listRecipients(teacher.id, draft.id)).toHaveLength(1);
  });

  it('enforces class owner, private exam revision and account downgrade at mutation time', async () => {
    const { teacher, classroom, revision, create } = await fixture();
    const anotherTeacher = await createUser('teacher');
    const anotherClass = await classes.createClass(anotherTeacher.id, {
      name: 'Lớp khác',
      joinMode: 'AUTO',
    });
    await expect(
      assignments.create(anotherTeacher.id, {
        classId: anotherClass.id,
        examRevisionId: revision.id,
        audienceMode: 'ALL_CLASS',
        selectedUserIds: [],
        openAt,
        closeAt,
      }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'exam_revision_not_found' });
    await expect(
      assignments.create(anotherTeacher.id, {
        classId: classroom.id,
        examRevisionId: revision.id,
        audienceMode: 'ALL_CLASS',
        selectedUserIds: [],
        openAt,
        closeAt,
      }),
    ).rejects.toMatchObject({ kind: 'forbidden' });

    const draft = await create('ALL_CLASS');
    await expect(assignments.publish(anotherTeacher.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(
      assignments.update(anotherTeacher.id, draft.id, { maxAttempts: 4 }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await db.update(users).set({ role: 'user' }).where(eq(users.id, teacher.id));
    await expect(assignments.publish(teacher.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(assignments.get(teacher.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('serializes simultaneous publish and suspension against the same class', async () => {
    const { teacher, classroom, join, create } = await fixture();
    const student = await createUser();
    await join(student.id);
    const draft = await create('SELECTED_USERS', [student.id]);

    const [published, suspended] = await Promise.allSettled([
      assignments.publish(teacher.id, draft.id),
      classes.suspendMember(teacher.id, classroom.id, student.id),
    ]);
    expect(suspended.status).toBe('fulfilled');
    if (published.status === 'fulfilled') {
      expect(published.value.status).toBe('published');
      expect(await assignments.listRecipients(teacher.id, draft.id)).toHaveLength(1);
    } else {
      expect(published.reason).toMatchObject({ code: 'assignment_recipients_invalid' });
      expect((await assignments.get(teacher.id, draft.id)).status).toBe('draft');
      expect(await assignments.listRecipients(teacher.id, draft.id)).toHaveLength(0);
    }
    await expect(assignments.getDelivery(student.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('serves only assigned question images, never hidden guidance or revoked images', async () => {
    const { teacher, classroom, join } = await fixture();
    const student = await createUser();
    const suspended = await createUser();
    const unselected = await createUser();
    await join(student.id);
    await join(suspended.id);
    await join(unselected.id);

    const repository = new PostgresFilesRepository(db);
    const metadata = (label: string) => {
      const contentHash = createHash('sha256').update(label).digest('hex');
      return {
        contentHash,
        storageKey: `files/${contentHash.slice(0, 2)}/${contentHash}`,
        mimeType: 'image/png',
        byteSize: 3,
        width: 1,
        height: 1,
      };
    };
    const visible = await repository.create({
      ...metadata('abc'),
      createdByUserId: teacher.id,
      parentFileId: null,
      originalFilename: 'visible.png',
    });
    const hidden = await repository.create({
      ...metadata('def'),
      createdByUserId: teacher.id,
      parentFileId: null,
      originalFilename: 'hidden.png',
    });
    const variant = await repository.createVariant({
      ...metadata('ghi'),
      createdByUserId: teacher.id,
      parentFileId: visible.id,
      originalFilename: 'crop.png',
    });

    const fileNode = (fileId: string, variantFileId: string | null) => ({
      type: 'image' as const,
      attrs: {
        fileId,
        variantFileId,
        alt: null,
        title: null,
        width: null,
        height: null,
        align: 'center' as const,
        crop: variantFileId ? { x: 0, y: 0, width: 100, height: 100 } : null,
      },
    });
    const question = await questions.createQuestion(
      {
        status: 'ready',
        type: 'short_answer',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Quan sát hình' }] },
            fileNode(visible.id, null),
            fileNode(visible.id, variant.id),
          ],
        },
        guidance: { type: 'doc', content: [fileNode(hidden.id, null)] },
        solution: { answer: '42' },
      },
      teacher.id,
    );
    const exam = await exams.createExam(teacher.id, { title: 'Đề có ảnh' });
    const revision = await exams.createRevision(teacher.id, exam.id, {
      questions: [{ questionId: question.id, version: question.version }],
    });
    const draft = await assignments.create(teacher.id, {
      classId: classroom.id,
      examRevisionId: revision.id,
      audienceMode: 'SELECTED_USERS',
      selectedUserIds: [student.id, suspended.id],
      openAt,
      closeAt,
    });
    await assignments.publish(teacher.id, draft.id);

    const storage = { get: vi.fn(async () => ({ body: Buffer.from('abc') })) };
    const assets = new FilesService(repository, storage as never, authorization, () => now);
    expect(
      (await assignments.getDelivery(student.id, draft.id)).questions[0].question.content,
    ).toEqual(expect.objectContaining({ type: 'doc' }));
    await expect(assets.getFile(visible.id, student.id)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    await expect(assets.getVariant(visible.id, variant.id, student.id)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    await expect(assets.getFile(hidden.id, student.id)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    await expect(assets.getFile(visible.id, unselected.id)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    await classes.suspendMember(teacher.id, classroom.id, suspended.id);
    await expect(assets.getFile(visible.id, suspended.id)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    await assignments.revokeRecipient(teacher.id, draft.id, student.id);
    await expect(assets.getFile(visible.id, student.id)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it('validates windows, selection uniqueness and does not expose draft or early delivery', async () => {
    const { teacher, create, join } = await fixture();
    const student = await createUser();
    await join(student.id);
    await expect(create('SELECTED_USERS', [student.id, student.id])).rejects.toMatchObject({
      kind: 'invalid',
    });
    const draft = await create('SELECTED_USERS', [student.id]);
    await assignments.update(teacher.id, draft.id, {
      openAt: new Date(now.getTime() + 10_000).toISOString(),
    });
    await assignments.publish(teacher.id, draft.id);
    await expect(assignments.getDelivery(student.id, draft.id)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_available',
    });
    await expect(
      assignments.update(teacher.id, draft.id, { closeAt: openAt }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });
});
