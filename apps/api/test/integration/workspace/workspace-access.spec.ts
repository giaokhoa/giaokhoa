import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClassesService } from '@giaokhoa/application/classes/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { ExamsService } from '@giaokhoa/application/exams/service';
import { AssignmentsService } from '@giaokhoa/application/assignments/service';
import { AttemptsService } from '@giaokhoa/application/attempts/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import { PostgresExamsRepository } from '@giaokhoa/database/exams';
import { PostgresAssignmentsRepository } from '@giaokhoa/database/assignments';
import { PostgresAttemptsRepository } from '@giaokhoa/database/attempts';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import * as schema from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import { eq } from 'drizzle-orm';
import { grantSystemRole, revokeSystemRole } from '../../helpers/roles.js';

const databaseName = `gk_workspace_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
let db: Database;
let authorization: AuthorizationService;
let authorizationRepository: PostgresAuthorizationRepository;
let classes: ClassesService;
let questions: QuestionsService;
let exams: ExamsService;
let assignments: AssignmentsService;
let attempts: AttemptsService;
function databaseUrl(name: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}
async function admin(run: (client: Client) => Promise<unknown>) {
  const client = new Client({ connectionString: databaseUrl('postgres') });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}
beforeAll(async () => {
  await admin((client) => client.query(`CREATE DATABASE "${databaseName}"`));
  pool = new Pool({ connectionString: databaseUrl(databaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  authorizationRepository = new PostgresAuthorizationRepository(db);
  authorization = new AuthorizationService(authorizationRepository);
  classes = new ClassesService(new PostgresClassesRepository(db), authorization);
  questions = new QuestionsService(new PostgresQuestionsRepository(db), authorization);
  exams = new ExamsService(new PostgresExamsRepository(db), authorization);
  assignments = new AssignmentsService(new PostgresAssignmentsRepository(db), authorization);
  attempts = new AttemptsService(new PostgresAttemptsRepository(db), authorization);
}, 30000);
afterAll(async () => {
  await pool?.end();
  await admin((client) => client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`));
}, 30000);
async function user(teacher = false) {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Người kiểm thử', email: `${randomUUID()}@example.com` })
    .returning();
  if (teacher) await grantSystemRole(db, user.id, 'teacher');
  return user;
}
const document = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
});
async function fixture() {
  const teacher = await user(true),
    student = await user(),
    outsider = await user(true);
  const classroom = await classes.createClass(teacher.id, {
    name: 'Lớp kiểm thử',
    joinMode: 'AUTO',
  });
  const code = await classes.createJoinCode(teacher.id, classroom.id, { expiresInHours: 1 });
  await classes.joinClass(student.id, code.code);
  const question = await questions.createQuestion(
    {
      type: 'short_answer',
      status: 'ready',
      content: document('Câu hỏi gốc'),
      solution: { answer: '42' },
    },
    teacher.id,
  );
  const exam = await exams.createExam(teacher.id, { title: 'Đề kiểm thử' });
  const revision = await exams.createRevision(teacher.id, exam.id, {
    questions: [{ questionId: question.id, version: question.version }],
  });
  const assignment = await assignments.create(teacher.id, {
    classId: classroom.id,
    examRevisionId: revision.id,
    audienceMode: 'ALL_CLASS',
    openAt: new Date(Date.now() - 60000).toISOString(),
    closeAt: new Date(Date.now() + 3600000).toISOString(),
    maxAttempts: 2,
  });
  return { teacher, student, outsider, classroom, question, assignment, code };
}

describe('Dữ liệu giao diện theo quyền hiện hành', () => {
  it('chỉ liệt kê lớp được phép xem, bài nháp cho người quản lý và bài đã công bố cho người nhận', async () => {
    const f = await fixture();
    expect((await classes.listClasses(f.teacher.id)).map((item) => item.id)).toContain(
      f.classroom.id,
    );
    expect((await classes.listClasses(f.student.id)).map((item) => item.id)).toEqual([
      f.classroom.id,
    ]);
    expect(await classes.listClasses(f.outsider.id)).toEqual([]);
    expect(await assignments.list(f.student.id)).toEqual([]);
    expect(await assignments.list(f.outsider.id)).toEqual([]);
    expect((await assignments.list(f.teacher.id))[0].capabilities).toContain('assignment:grade');
    await assignments.publish(f.teacher.id, f.assignment.id);
    const [summary] = await assignments.list(f.student.id);
    expect(summary.capabilities).toContain('assignment:attempt');
    expect(summary.capabilities).not.toContain('assignment:create');
    expect(summary).not.toHaveProperty('selectedUserIds');
    expect(summary).not.toHaveProperty('questions');
    await assignments.revokeRecipient(f.teacher.id, f.assignment.id, f.student.id);
    expect(await assignments.list(f.student.id)).toEqual([]);
  });

  it('chỉ trả phiên bản câu hỏi mới nhất của tác giả và cập nhật quyền ngay khi vai trò bị thu hồi', async () => {
    const f = await fixture();
    await questions.updateQuestion(
      f.question.id,
      { content: document('Câu hỏi đã sửa') },
      1,
      f.teacher.id,
    );
    const [question] = await questions.listQuestions(f.teacher.id);
    expect(question.version).toBe(2);
    expect(question).not.toHaveProperty('createdByUserId');
    expect(await questions.listQuestions(f.outsider.id)).toEqual([]);
    await revokeSystemRole(db, f.teacher.id, 'teacher');
    const access = await authorization.checkCapabilities(
      f.teacher.id,
      { kind: 'system', resourceKey: 'giaokhoa' },
      ['question:create_own', 'question:manage_own', 'class:join'],
    );
    expect(access.capabilities).toEqual(['class:join']);
    await expect(questions.listQuestions(f.teacher.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('giáo viên được ủy quyền xem bản chụp để chấm, còn học sinh và giáo viên ngoài lớp bị từ chối', async () => {
    const f = await fixture();
    const grader = await user();
    const context = await authorizationRepository.findContext({
      kind: 'class',
      resourceKey: f.classroom.id,
    });
    await authorization.changeRole(f.teacher.id, context!.id, grader.id, 'class:teacher', true);
    await questions.updateQuestion(
      f.question.id,
      { content: document('Nội dung mới'), solution: { answer: '43' } },
      1,
      f.teacher.id,
    );
    const preview = await assignments.preview(grader.id, f.assignment.id);
    expect(preview.questions[0].question.content).toEqual(document('Câu hỏi gốc'));
    expect(preview.questions[0].question.solution).toEqual({ answer: '42' });
    await expect(assignments.preview(f.student.id, f.assignment.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(assignments.preview(f.outsider.id, f.assignment.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    const systemAccess = await authorization.checkCapabilities(
      grader.id,
      { kind: 'system', resourceKey: 'giaokhoa' },
      ['question:create_own', 'class:create'],
    );
    expect(systemAccess.capabilities).toEqual([]);
    const scoped = await classes.listClasses(grader.id);
    expect(scoped[0].capabilities).toContain('assignment:grade');
  });

  it('không công khai điểm, nhận xét hoặc câu trả lời trong danh sách lượt làm và ẩn lớp khi bị đình chỉ', async () => {
    const f = await fixture();
    await assignments.publish(f.teacher.id, f.assignment.id);
    const attempt = await attempts.start(f.student.id, f.assignment.id);
    await attempts.save(f.student.id, attempt.id, 1, { type: 'short_answer', answer: '42' });
    await attempts.submit(f.student.id, attempt.id);
    await attempts.grade(f.teacher.id, attempt.id, { score: 95, feedback: 'Nhận xét riêng' });
    const list = await attempts.listOwn(f.student.id);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('graded');
    for (const key of ['score', 'scoreBasisPoints', 'feedback', 'responses'])
      expect(list[0]).not.toHaveProperty(key);
    expect(await attempts.listOwn(f.outsider.id)).toEqual([]);
    await classes.suspendMember(f.teacher.id, f.classroom.id, f.student.id);
    expect(await classes.listClasses(f.student.id)).toEqual([]);
    expect(await assignments.list(f.student.id)).toEqual([]);
    expect(await attempts.listOwn(f.student.id)).toEqual([]);
  });

  it('quyền cấm tại bài giao phủ quyết quyền học sinh và tài khoản bị khóa không nhận quyền', async () => {
    const f = await fixture();
    await assignments.publish(f.teacher.id, f.assignment.id);
    const context = await authorizationRepository.findContext({
      kind: 'assignment',
      resourceKey: f.assignment.id,
    });
    await authorization.overrideRole(
      f.teacher.id,
      context!.id,
      'class:student',
      'assignment:view_assigned',
      'PROHIBIT',
    );
    expect(await assignments.list(f.student.id)).toEqual([]);
    await db.update(schema.users).set({ banned: true }).where(eq(schema.users.id, f.teacher.id));
    expect(
      (
        await authorization.checkCapabilities(
          f.teacher.id,
          { kind: 'system', resourceKey: 'giaokhoa' },
          ['question:manage_own', 'class:create'],
        )
      ).capabilities,
    ).toEqual([]);
    expect(await classes.listClasses(f.teacher.id)).toEqual([]);
  });

  it('phát hiện quyền của vai trò người dùng ngầm định trong danh sách tài nguyên', async () => {
    const f = await fixture();
    const administrator = await user();
    await grantSystemRole(db, administrator.id, 'admin');
    const viewer = await user();
    try {
      await authorization.setRolePermission(administrator.id, 'system:user', 'class:view', 'ALLOW');
      await authorization.setRolePermission(
        administrator.id,
        'system:user',
        'assignment:grade',
        'ALLOW',
      );
      expect((await classes.listClasses(viewer.id)).map((item) => item.id)).toContain(
        f.classroom.id,
      );
      const visible = await assignments.list(viewer.id);
      expect(visible.find((item) => item.id === f.assignment.id)?.capabilities).toContain(
        'assignment:grade',
      );
    } finally {
      await authorization.setRolePermission(
        administrator.id,
        'system:user',
        'class:view',
        'INHERIT',
      );
      await authorization.setRolePermission(
        administrator.id,
        'system:user',
        'assignment:grade',
        'INHERIT',
      );
    }
    expect(await classes.listClasses(viewer.id)).toEqual([]);
    expect(await assignments.list(viewer.id)).toEqual([]);
  });

  it('không liệt kê lượt đang làm khi người nhận bị thu hồi quyền nhận bài', async () => {
    const f = await fixture();
    await assignments.publish(f.teacher.id, f.assignment.id);
    await attempts.start(f.student.id, f.assignment.id);
    expect(await attempts.listOwn(f.student.id)).toHaveLength(1);
    await assignments.revokeRecipient(f.teacher.id, f.assignment.id, f.student.id);
    expect(await attempts.listOwn(f.student.id)).toEqual([]);
  });
});
