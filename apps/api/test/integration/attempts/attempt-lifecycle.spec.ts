import { grantSystemRole, revokeRole } from '../../helpers/roles.js';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '@giaokhoa/application/assignments/service';
import { AttemptsService } from '@giaokhoa/application/attempts/service';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClassesService } from '@giaokhoa/application/classes/service';
import { ExamsService } from '@giaokhoa/application/exams/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresAssignmentsRepository } from '@giaokhoa/database/assignments';
import { PostgresAttemptsRepository } from '@giaokhoa/database/attempts';
import {
  PostgresAuthorizationRepository,
  lockAuthorizationMutation,
} from '@giaokhoa/database/authorization';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import { PostgresExamsRepository } from '@giaokhoa/database/exams';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import * as schema from '@giaokhoa/database/schema';
import { users } from '@giaokhoa/database/schema';
import { attempts as attemptRows, attemptResponses } from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';

const databaseName = `gk_attempt_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const openAt = new Date(NOW.getTime() - 60_000).toISOString();
const closeAt = new Date(NOW.getTime() + 3_600_000).toISOString();
const doc = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Câu hỏi?' }] }],
};
let clock = NOW;
let pool: Pool;
let db: Database;
let assignments: AssignmentsService;
let attempts: AttemptsService;
let classes: ClassesService;
let exams: ExamsService;
let questions: QuestionsService;

function databaseUrl(name: string) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for attempt lifecycle E2E');
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

async function createUser(role: 'teacher' | 'admin' | 'user' = 'user') {
  const [user] = await db
    .insert(users)
    .values({
      name: role,
      email: `${randomUUID()}@example.com`,
    })
    .returning();
  if (role !== 'user') await grantSystemRole(db, user.id, role);
  return user;
}

async function fixture() {
  const teacher = await createUser('teacher');
  const classroom = await classes.createClass(teacher.id, { name: 'Lớp toán', joinMode: 'AUTO' });
  const question = await questions.createQuestion(
    {
      status: 'ready',
      type: 'short_answer',
      content: doc,
      solution: { answer: '42' },
    },
    teacher.id,
  );
  const exam = await exams.createExam(teacher.id, { title: 'Đề thi gốc' });
  const revision = await exams.createRevision(teacher.id, exam.id, {
    questions: [{ questionId: question.id, version: question.version }],
  });
  const joinCode = await classes.createJoinCode(teacher.id, classroom.id, { expiresInHours: 24 });
  const enrol = async (userId: string) => classes.joinClass(userId, joinCode.code);
  const create = (values: Record<string, unknown> = {}) =>
    assignments.create(teacher.id, {
      classId: classroom.id,
      examRevisionId: revision.id,
      audienceMode: 'ALL_CLASS',
      selectedUserIds: [],
      openAt,
      closeAt,
      maxAttempts: 2,
      ...values,
    } as Parameters<AssignmentsService['create']>[1]);
  const publish = async (values: Record<string, unknown> = {}) => {
    const draft = await create(values);
    return assignments.publish(teacher.id, draft.id);
  };
  return { teacher, classroom, revision, enrol, create, publish };
}

beforeAll(async () => {
  await adminConnection((client) => client.query(`CREATE DATABASE "${databaseName}"`));
  pool = new Pool({ connectionString: databaseUrl(databaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  const authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
  assignments = new AssignmentsService(
    new PostgresAssignmentsRepository(db),
    authorization,
    () => clock,
  );
  attempts = new AttemptsService(new PostgresAttemptsRepository(db), authorization, () => clock);
  classes = new ClassesService(new PostgresClassesRepository(db), authorization);
  exams = new ExamsService(new PostgresExamsRepository(db), authorization);
  questions = new QuestionsService(new PostgresQuestionsRepository(db), authorization);
}, 30_000);

beforeEach(() => {
  clock = NOW;
});

afterAll(async () => {
  await pool?.end();
  await adminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
  );
}, 30_000);

describe('Quyền sở hữu, vòng đời bài làm và công bố kết quả', () => {
  it('bắt đầu bài làm lặp lại an toàn khi đồng thời, giới hạn số lần làm và không trùng số thứ tự', async () => {
    const { enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish();
    const started = await Promise.all(
      Array.from({ length: 6 }, () => attempts.start(student.id, assignment.id)),
    );
    expect(new Set(started.map((a) => a.id)).size).toBe(1);
    expect(started[0].attemptNumber).toBe(1);
    expect(
      await db.select().from(attemptRows).where(eq(attemptRows.assignmentId, assignment.id)),
    ).toHaveLength(1);

    await attempts.submit(student.id, started[0].id);
    const second = await Promise.all([
      attempts.start(student.id, assignment.id),
      attempts.start(student.id, assignment.id),
    ]);
    expect(second[0].id).toBe(second[1].id);
    expect(second[0].attemptNumber).toBe(2);
    await attempts.submit(student.id, second[0].id);
    await expect(attempts.start(student.id, assignment.id)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'attempts_exhausted',
    });
    const numbers = await db
      .select({ number: attemptRows.attemptNumber })
      .from(attemptRows)
      .where(eq(attemptRows.assignmentId, assignment.id));
    expect(numbers.map(({ number }) => number).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('từ chối bắt đầu bài nháp, trước giờ hoặc quá hạn mà không tạo bài làm', async () => {
    const { enrol, create, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const draft = await create();
    await expect(attempts.start(student.id, draft.id)).rejects.toMatchObject({ kind: 'not_found' });

    const early = await publish({ openAt: new Date(NOW.getTime() + 20_000).toISOString() });
    await expect(attempts.start(student.id, early.id)).rejects.toMatchObject({
      code: 'attempt_window_closed',
    });
    const expired = await publish({ closeAt: new Date(NOW.getTime() - 10_000).toISOString() });
    await expect(attempts.start(student.id, expired.id)).rejects.toMatchObject({
      code: 'attempt_window_closed',
    });
    expect(
      await db
        .select()
        .from(attemptRows)
        .where(inArray(attemptRows.assignmentId, [draft.id, early.id, expired.id])),
    ).toHaveLength(0);
  });

  it('lưu câu trả lời đúng kiểu, chặn câu hỏi không thuộc bài và khóa bài đã nộp', async () => {
    const { enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish();
    const started = await attempts.start(student.id, assignment.id);
    const id = started.id;
    await expect(
      attempts.save(student.id, id, 2, { type: 'short_answer', answer: '12' }),
    ).rejects.toMatchObject({ code: 'attempt_answer_invalid' });
    await expect(
      attempts.save(student.id, id, 1, {
        type: 'multiple_choice',
        choiceId: '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20',
      }),
    ).rejects.toMatchObject({ code: 'attempt_answer_invalid' });
    await attempts.save(student.id, id, 1, { type: 'short_answer', answer: '12' });
    const saved = await attempts.save(student.id, id, 1, { type: 'short_answer', answer: '23' });
    expect(saved.responses).toHaveLength(1);
    expect(saved.responses[0].answer).toEqual({ type: 'short_answer', answer: '23' });
    expect(JSON.stringify(saved)).not.toContain('"solution"');
    expect(
      await db.select().from(attemptResponses).where(eq(attemptResponses.attemptId, id)),
    ).toHaveLength(1);

    const submitted = await attempts.submit(student.id, id);
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    await expect(
      attempts.save(student.id, id, 1, { type: 'short_answer', answer: '42' }),
    ).rejects.toMatchObject({ code: 'attempt_not_in_progress' });
    await expect(attempts.submit(student.id, id)).rejects.toMatchObject({
      code: 'attempt_not_in_progress',
    });
    expect((await attempts.getOwn(student.id, id)).responses[0].answer).toEqual({
      type: 'short_answer',
      answer: '23',
    });

    const second = await attempts.start(student.id, assignment.id);
    clock = new Date(NOW.getTime() + 3_600_001);
    await expect(
      attempts.save(student.id, second.id, 1, { type: 'short_answer', answer: '12' }),
    ).rejects.toMatchObject({ code: 'attempt_window_closed' });
    await expect(attempts.submit(student.id, second.id)).rejects.toMatchObject({
      code: 'attempt_window_closed',
    });
  });

  it('chặn lưu và nộp sau khi đình chỉ hoặc thu hồi người nhận, vẫn giữ bài làm', async () => {
    const { teacher, classroom, enrol, publish } = await fixture();
    const suspended = await createUser();
    const revoked = await createUser();
    await enrol(suspended.id);
    await enrol(revoked.id);
    const assignment = await publish();
    const first = await attempts.start(suspended.id, assignment.id);
    const second = await attempts.start(revoked.id, assignment.id);
    await classes.suspendMember(teacher.id, classroom.id, suspended.id);
    await assignments.revokeRecipient(teacher.id, assignment.id, revoked.id);
    await expect(
      attempts.save(suspended.id, first.id, 1, { type: 'short_answer', answer: '1' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(attempts.submit(suspended.id, first.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(
      attempts.save(revoked.id, second.id, 1, { type: 'short_answer', answer: '1' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(attempts.submit(revoked.id, second.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(attempts.start(revoked.id, assignment.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(
      await db.select().from(attemptRows).where(eq(attemptRows.assignmentId, assignment.id)),
    ).toHaveLength(2);
  });

  it('từ chối lưu, nộp và bắt đầu lượt mới sau khi thu hồi vai trò dù kiểm tra trước đó đã thành công', async () => {
    const { classroom, enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish();
    const started = await attempts.start(student.id, assignment.id);
    const authz = new AuthorizationService(new PostgresAuthorizationRepository(db));
    expect(
      await authz.authorize({
        actorId: student.id,
        capability: 'assignment:attempt',
        context: { kind: 'assignment', resourceKey: assignment.id },
      }),
    ).toMatchObject({ allowed: true });
    await revokeRole(db, student.id, 'class:student', 'class', classroom.id);
    const repository = new PostgresAttemptsRepository(db);
    await expect(
      repository.save(started.id, student.id, 1, { type: 'short_answer', answer: '99' }, NOW),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(repository.submit(started.id, student.id, NOW)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(repository.start(assignment.id, student.id, NOW)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(
      await db.select().from(attemptResponses).where(eq(attemptResponses.attemptId, started.id)),
    ).toHaveLength(0);
    expect(
      (
        await db
          .select({ status: attemptRows.status })
          .from(attemptRows)
          .where(eq(attemptRows.id, started.id))
      )[0].status,
    ).toBe('in_progress');
  });

  it('giao dịch thu hồi quyền chạy xen kẽ không thể cho lưu đáp án sau thời điểm thu hồi', async () => {
    const { classroom, enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish();
    const started = await attempts.start(student.id, assignment.id);
    const [context] = await db
      .select({ id: schema.authzContexts.id })
      .from(schema.authzContexts)
      .where(
        and(
          eq(schema.authzContexts.kind, 'class'),
          eq(schema.authzContexts.resourceKey, classroom.id),
        ),
      )
      .limit(1);
    let release!: () => void;
    let entered!: () => void;
    const enteredLock = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const allowCommit = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revocation = db.transaction(async (tx) => {
      await lockAuthorizationMutation(tx);
      await tx
        .update(schema.authzRoleAssignments)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.authzRoleAssignments.contextId, context.id),
            eq(schema.authzRoleAssignments.userId, student.id),
          ),
        );
      entered();
      await allowCommit;
    });
    await enteredLock;
    const repository = new PostgresAttemptsRepository(db);
    const pendingWrite = repository
      .save(started.id, student.id, 1, { type: 'short_answer', answer: '99' }, NOW)
      .then(
        () => 'allowed',
        () => 'denied',
      );
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      release();
    }
    await revocation;
    expect(await pendingWrite).toBe('denied');
    expect(
      await db.select().from(attemptResponses).where(eq(attemptResponses.attemptId, started.id)),
    ).toHaveLength(0);
  });

  it('không trả 87 điểm khi quyền PREVENT hoặc PROHIBIT sau khi học sinh rời lớp', async () => {
    const { teacher, classroom, enrol, publish } = await fixture();
    const student = await createUser();
    const admin = await createUser('admin');
    await enrol(student.id);
    const assignment = await publish({
      releaseScoreAt: new Date(NOW.getTime() - 10_000).toISOString(),
      releaseFeedbackAt: new Date(NOW.getTime() - 10_000).toISOString(),
      releaseSolutionsAt: new Date(NOW.getTime() - 10_000).toISOString(),
    });
    const attempt = await attempts.start(student.id, assignment.id);
    await attempts.submit(student.id, attempt.id);
    await attempts.grade(teacher.id, attempt.id, { score: 87 });
    expect((await attempts.result(student.id, attempt.id)).score).toBe(87);
    await classes.leaveClass(student.id, classroom.id);
    const authz = new AuthorizationService(new PostgresAuthorizationRepository(db));
    const [context] = await db
      .select({ id: schema.authzContexts.id })
      .from(schema.authzContexts)
      .where(
        and(
          eq(schema.authzContexts.kind, 'assignment'),
          eq(schema.authzContexts.resourceKey, assignment.id),
        ),
      )
      .limit(1);
    for (const effect of ['PREVENT', 'PROHIBIT'] as const) {
      await authz.overrideRole(admin.id, context.id, 'system:user', 'result:view_own', effect);
      try {
        expect(
          await authz.authorize({
            actorId: student.id,
            capability: 'result:view_own',
            context: { kind: 'assignment', resourceKey: assignment.id },
          }),
        ).toMatchObject({
          allowed: false,
          reason: effect === 'PREVENT' ? 'prevented' : 'prohibited',
        });
        await expect(attempts.result(student.id, attempt.id)).rejects.toMatchObject({
          kind: 'forbidden',
        });
        await expect(attempts.solutions(student.id, attempt.id)).rejects.toMatchObject({
          kind: 'forbidden',
        });
      } finally {
        await authz.overrideRole(admin.id, context.id, 'system:user', 'result:view_own', 'INHERIT');
      }
    }
    expect(
      await authz.authorize({
        actorId: student.id,
        capability: 'result:view_own',
        context: { kind: 'assignment', resourceKey: assignment.id },
      }),
    ).toMatchObject({ allowed: false });
    await expect(attempts.result(student.id, attempt.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('ngăn học sinh khác, giáo viên và quản trị viên xem bài làm và điểm riêng tư', async () => {
    const { teacher, enrol, publish } = await fixture();
    const first = await createUser();
    const second = await createUser();
    const otherTeacher = await createUser('teacher');
    const admin = await createUser('admin');
    await enrol(first.id);
    await enrol(second.id);
    const assignment = await publish();
    const started = await attempts.start(first.id, assignment.id);
    await expect(attempts.getOwn(second.id, started.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(
      attempts.save(second.id, started.id, 1, { type: 'short_answer', answer: '1' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
    await expect(attempts.submit(second.id, started.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(attempts.review(otherTeacher.id, started.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(attempts.grade(admin.id, started.id, { score: 100 })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(attempts.listForTeacher(otherTeacher.id, assignment.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(attempts.grade(teacher.id, started.id, { score: 100 })).rejects.toMatchObject({
      code: 'attempt_not_submitted',
    });
    await attempts.submit(first.id, started.id);
    await expect(attempts.result(second.id, started.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(attempts.solutions(second.id, started.id)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('chỉ chấm bài thuộc lớp của mình, công bố điểm, nhận xét và lời giải độc lập', async () => {
    const { teacher, classroom, enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const scoreAt = new Date(NOW.getTime() + 10_000).toISOString();
    const feedbackAt = new Date(NOW.getTime() + 20_000).toISOString();
    const solutionsAt = new Date(NOW.getTime() + 30_000).toISOString();
    const assignment = await publish({
      releaseScoreAt: scoreAt,
      releaseFeedbackAt: feedbackAt,
      releaseSolutionsAt: solutionsAt,
    });
    const started = await attempts.start(student.id, assignment.id);
    await attempts.save(student.id, started.id, 1, { type: 'short_answer', answer: '31' });
    await attempts.submit(student.id, started.id);
    await expect(attempts.result(student.id, started.id)).rejects.toMatchObject({
      code: 'result_not_released',
    });
    await expect(attempts.solutions(student.id, started.id)).rejects.toMatchObject({
      code: 'solutions_not_released',
    });

    const graded = await attempts.grade(teacher.id, started.id, { score: 91.5, feedback: 'Tốt' });
    expect(graded.score).toBe(91.5);
    expect(graded.feedback).toBe('Tốt');
    expect(graded.responses).toHaveLength(1);
    expect((await attempts.listForTeacher(teacher.id, assignment.id))[0]).toMatchObject({
      userId: student.id,
      name: student.name,
      email: student.email,
    });
    expect((await attempts.review(teacher.id, started.id)).score).toBe(91.5);
    await expect(attempts.result(student.id, started.id)).rejects.toMatchObject({
      code: 'result_not_released',
    });

    clock = new Date(NOW.getTime() + 15_000);
    expect(await attempts.result(student.id, started.id)).toMatchObject({
      score: 91.5,
      feedback: null,
    });
    await expect(attempts.solutions(student.id, started.id)).rejects.toMatchObject({
      code: 'solutions_not_released',
    });
    clock = new Date(NOW.getTime() + 35_000);
    expect(await attempts.result(student.id, started.id)).toMatchObject({
      score: 91.5,
      feedback: 'Tốt',
    });
    expect((await attempts.solutions(student.id, started.id)).questions).toEqual([
      { position: 1, solution: { answer: '42' } },
    ]);

    await classes.leaveClass(student.id, classroom.id);
    await expect(attempts.result(student.id, started.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(attempts.getOwn(student.id, started.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(attempts.start(student.id, assignment.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('cho xem nhận xét mà không lộ điểm, chặn kết quả cũ với tài khoản bị đình chỉ', async () => {
    const { teacher, classroom, enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish({
      releaseScoreAt: new Date(NOW.getTime() + 30_000).toISOString(),
      releaseFeedbackAt: openAt,
    });
    const started = await attempts.start(student.id, assignment.id);
    await attempts.submit(student.id, started.id);
    await attempts.grade(teacher.id, started.id, { score: 80, feedback: 'Cần ôn thêm' });
    expect(await attempts.result(student.id, started.id)).toMatchObject({
      score: null,
      feedback: 'Cần ôn thêm',
    });
    await assignments.revokeRecipient(teacher.id, assignment.id, student.id);
    expect((await attempts.result(student.id, started.id)).feedback).toBe('Cần ôn thêm');
    await classes.suspendMember(teacher.id, classroom.id, student.id);
    await expect(attempts.result(student.id, started.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('từ chối lịch sử khi tài khoản bị cấm và phục hồi khi mở khóa', async () => {
    const { teacher, classroom, enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish({ releaseScoreAt: openAt });
    const attempt = await attempts.start(student.id, assignment.id);
    await attempts.submit(student.id, attempt.id);
    await attempts.grade(teacher.id, attempt.id, { score: 75 });
    await classes.leaveClass(student.id, classroom.id);
    await expect(attempts.result(student.id, attempt.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });

    await db.update(users).set({ banned: true }).where(eq(users.id, student.id));
    await expect(attempts.result(student.id, attempt.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await db.update(users).set({ banned: false }).where(eq(users.id, student.id));
    await expect(attempts.result(student.id, attempt.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('xử lý xung đột giữa lưu và nộp, từ chối chấm khi thu hồi vai trò chủ lớp', async () => {
    const { teacher, classroom, enrol, publish } = await fixture();
    const student = await createUser();
    await enrol(student.id);
    const assignment = await publish();
    const started = await attempts.start(student.id, assignment.id);
    const writes = await Promise.allSettled([
      attempts.save(student.id, started.id, 1, { type: 'short_answer', answer: '5' }),
      attempts.submit(student.id, started.id),
    ]);
    expect(writes[1].status).toBe('fulfilled');
    expect(
      writes[0].status === 'fulfilled' ||
        (writes[0].status === 'rejected' &&
          (writes[0].reason as { code?: string }).code === 'attempt_not_in_progress'),
    ).toBe(true);
    expect((await attempts.getOwn(student.id, started.id)).status).toBe('submitted');
    await revokeRole(db, teacher.id, 'class:owner', 'class', classroom.id);
    await expect(attempts.grade(teacher.id, started.id, { score: 90 })).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
});
