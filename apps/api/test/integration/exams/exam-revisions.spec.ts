import { grantSystemRole, revokeSystemRole } from '../../helpers/roles.js';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ExamsService } from '@giaokhoa/application/exams/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresExamsRepository } from '@giaokhoa/database/exams';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import * as schema from '@giaokhoa/database/schema';
import { users } from '@giaokhoa/database/schema';
import { examRevisions, examRevisionQuestions } from '@giaokhoa/database/schema';
import { questionVersions } from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import { examRevisionCreateSchema } from '@giaokhoa/shared/exams';
import type { QuestionCreate } from '@giaokhoa/shared/questions';

const databaseName = `gk_revision_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const unknownQuestionId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20';
const document = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Nội dung' }] }],
};
let pool: Pool;
let db: Database;
let exams: ExamsService;
let questions: QuestionsService;

function databaseUrl(name: string) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for exam revision E2E');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
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

async function createUser(role: 'teacher' | 'admin' | 'user' = 'teacher') {
  const [row] = await db
    .insert(users)
    .values({
      name: role,
      email: `${randomUUID()}@example.com`,
    })
    .returning();
  if (role !== 'user') await grantSystemRole(db, row.id, role);
  return row;
}

function questionData(answer = '42', status: 'draft' | 'ready' = 'ready'): QuestionCreate {
  return { status, type: 'short_answer', content: document, solution: { answer } };
}

beforeAll(async () => {
  await adminConnection((client) => client.query(`CREATE DATABASE "${databaseName}"`));
  pool = new Pool({ connectionString: databaseUrl(databaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  const authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
  exams = new ExamsService(new PostgresExamsRepository(db), authorization);
  questions = new QuestionsService(new PostgresQuestionsRepository(db), authorization);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await adminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
  );
}, 30_000);

describe('Quyền sở hữu và tính bất biến của phiên bản đề thi', () => {
  it('bảo vệ đề thi riêng tư và từ chối học sinh biên soạn', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const admin = await createUser('admin');
    const student = await createUser('user');
    await expect(exams.createExam(student.id, { title: 'Forbidden' })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    const created = await exams.createExam(owner.id, { title: 'Private exam' });
    expect((await exams.listExams(owner.id)).map((exam) => exam.id)).toContain(created.id);
    expect(await exams.listExams(stranger.id)).toEqual([]);
    await expect(exams.getExam(stranger.id, created.id)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_not_found',
    });
    await expect(exams.getExam(admin.id, created.id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(
      exams.updateExam(stranger.id, created.id, { title: 'Stolen' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
    await expect(exams.listRevisions(stranger.id, created.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(
      exams.createRevision(stranger.id, created.id, {
        questions: [{ questionId: unknownQuestionId, version: 1 }],
      }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('giữ nguyên nội dung câu hỏi đã chốt và tên đề thi sau các thay đổi', async () => {
    const owner = await createUser();
    const q = await questions.createQuestion(questionData(), owner.id);
    const exam = await exams.createExam(owner.id, { title: 'Original' });
    const rev1 = await exams.createRevision(owner.id, exam.id, {
      questions: [{ questionId: q.id, version: q.version }],
    });
    expect(rev1.revision).toBe(1);
    expect(rev1.questions[0].question.solution).toEqual({ answer: '42' });
    await expect(
      questions.updateQuestion(q.id, { status: 'draft' }, 1, owner.id),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'question_in_exam' });
    await expect(questions.deleteQuestion(q.id, owner.id)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'question_in_exam',
    });

    const nextQuestion = await questions.updateQuestion(
      q.id,
      { solution: { answer: '99' } },
      1,
      owner.id,
    );
    expect(nextQuestion.version).toBe(2);
    await exams.updateExam(owner.id, exam.id, { title: 'Renamed' });
    const original = await exams.getRevision(owner.id, exam.id, 1);
    expect(original.title).toBe('Original');
    expect(original.questions[0].question.solution).toEqual({ answer: '42' });
    const rev2 = await exams.createRevision(owner.id, exam.id, {
      questions: [{ questionId: q.id, version: 2 }],
    });
    expect(rev2.revision).toBe(2);
    expect(rev2.title).toBe('Renamed');
    expect(rev2.questions[0].question.solution).toEqual({ answer: '99' });
    expect((await exams.listRevisions(owner.id, exam.id)).map((item) => item.revision)).toEqual([
      2, 1,
    ]);
    expect((await exams.getRevision(owner.id, exam.id, 1)).questions[0].question.solution).toEqual({
      answer: '42',
    });
  });

  it('từ chối câu hỏi nháp, không tồn tại hoặc thuộc giáo viên khác, không để lại bản ghi phiên bản', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const owned = await questions.createQuestion(questionData(), owner.id);
    const privateOther = await questions.createQuestion(questionData(), stranger.id);
    const draft = await questions.createQuestion(questionData('2', 'draft'), owner.id);
    const exam = await exams.createExam(owner.id, { title: 'Deny references' });

    expect(
      examRevisionCreateSchema.safeParse({
        questions: [
          { questionId: owned.id, version: 1 },
          { questionId: owned.id, version: 2 },
        ],
      }).success,
    ).toBe(false);
    await expect(
      exams.createRevision(owner.id, exam.id, {
        questions: [
          { questionId: owned.id, version: 1 },
          { questionId: owned.id, version: 2 },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'exam_revision_invalid' });
    await expect(
      exams.createRevision(owner.id, exam.id, {
        questions: [
          { questionId: owned.id, version: 1 },
          { questionId: privateOther.id, version: 1 },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'exam_question_not_found' });
    await expect(
      exams.createRevision(owner.id, exam.id, {
        questions: [{ questionId: draft.id, version: 1 }],
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'exam_question_not_ready' });
    await expect(
      exams.createRevision(owner.id, exam.id, {
        questions: [{ questionId: unknownQuestionId, version: 1 }],
      }),
    ).rejects.toMatchObject({ kind: 'not_found' });
    expect(
      await db.select().from(examRevisions).where(eq(examRevisions.examId, exam.id)),
    ).toHaveLength(0);
  });

  it('tuần tự hóa việc sửa đề đồng thời và giữ thứ tự câu hỏi', async () => {
    const owner = await createUser();
    const first = await questions.createQuestion(questionData('11'), owner.id);
    const second = await questions.createQuestion(questionData('22'), owner.id);
    const exam = await exams.createExam(owner.id, { title: 'Concurrent' });
    const [a, b] = await Promise.all([
      exams.createRevision(owner.id, exam.id, {
        questions: [
          { questionId: first.id, version: 1 },
          { questionId: second.id, version: 1 },
        ],
      }),
      exams.createRevision(owner.id, exam.id, {
        questions: [
          { questionId: second.id, version: 1 },
          { questionId: first.id, version: 1 },
        ],
      }),
    ]);
    expect([a.revision, b.revision].sort((x, y) => x - y)).toEqual([1, 2]);
    expect(a.questions.map((item) => item.question.id)).toEqual([first.id, second.id]);
    expect(b.questions.map((item) => item.question.id)).toEqual([second.id, first.id]);
  });

  it('thực thi ràng buộc khóa ngoại RESTRICT ngay cả khi xóa trực tiếp trong database', async () => {
    const owner = await createUser();
    const q = await questions.createQuestion(questionData(), owner.id);
    const exam = await exams.createExam(owner.id, { title: 'FK' });
    const created = await exams.createRevision(owner.id, exam.id, {
      questions: [{ questionId: q.id, version: 1 }],
    });
    const [pinned] = await db
      .select()
      .from(examRevisionQuestions)
      .where(eq(examRevisionQuestions.examRevisionId, created.id));
    await expect(
      db.delete(questionVersions).where(eq(questionVersions.id, pinned.questionVersionId)),
    ).rejects.toThrow();
    expect((await exams.getRevision(owner.id, exam.id, 1)).questions).toHaveLength(1);
  });

  it('hoàn tác phiên bản đề khi thêm câu hỏi đã chốt thất bại', async () => {
    const owner = await createUser();
    const q = await questions.createQuestion(questionData(), owner.id);
    const exam = await exams.createExam(owner.id, { title: 'Rollback' });
    await db.execute(sql`CREATE FUNCTION revision_reject_pin() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced pin failure'; END $$`);
    await db.execute(sql`CREATE TRIGGER revision_reject_pin_trigger
      BEFORE INSERT ON exam_revision_questions FOR EACH ROW EXECUTE FUNCTION revision_reject_pin()`);
    try {
      await expect(
        exams.createRevision(owner.id, exam.id, {
          questions: [{ questionId: q.id, version: 1 }],
        }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER revision_reject_pin_trigger ON exam_revision_questions`);
      await db.execute(sql`DROP FUNCTION revision_reject_pin()`);
    }
    expect(
      await db.select().from(examRevisions).where(eq(examRevisions.examId, exam.id)),
    ).toHaveLength(0);
  });

  it('chặn tạo phiên bản mới khi giáo viên bị hạ vai trò nhưng vẫn giữ lịch sử', async () => {
    const owner = await createUser();
    const q = await questions.createQuestion(questionData(), owner.id);
    const exam = await exams.createExam(owner.id, { title: 'Historical' });
    await exams.createRevision(owner.id, exam.id, {
      questions: [{ questionId: q.id, version: 1 }],
    });
    await revokeSystemRole(db, owner.id, 'teacher');
    await expect(
      exams.createRevision(owner.id, exam.id, {
        questions: [{ questionId: q.id, version: 1 }],
      }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(
      await db.select().from(examRevisions).where(eq(examRevisions.examId, exam.id)),
    ).toHaveLength(1);
  });
});
