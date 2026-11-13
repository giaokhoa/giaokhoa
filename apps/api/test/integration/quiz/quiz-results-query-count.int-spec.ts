import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { QuestionBanksService } from '../../../src/modules/questions/question-banks.service';
import { QuestionsRepository } from '@giaokhoa/db/repositories/questions';
import { QuestionsService } from '../../../src/modules/questions/questions.service';
import { QuizRepository } from '@giaokhoa/db/repositories/quiz';
import { QuizService } from '../../../src/modules/quiz/quiz.service';
import {
  STRONG_PASSWORD, adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname,
} from '../../support/identity-access-helpers';
import {
  createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId,
} from '../../support/course-enrolment-helpers';
import { addExamSlot, createExamDraft, createReadyQuestion, pinExam } from '../../support/exam-pin-helpers';

describe('Quiz: số truy vấn của trang kết quả theo số học sinh (DL-03, issue #489)', () => {
  let app: INestApplication;
  let pg: Client;
  let quiz: QuizService;
  let pinId: string;
  let teacherId: string;
  let q1 = '';
  let q2 = '';
  const finishedStudentIds: string[] = [];
  let inprogressOnlyStudentId = '';
  let totalsSpy: ReturnType<typeof vi.spyOn>;
  let totalsQuerySpy: ReturnType<typeof vi.spyOn>;
  let listAttemptsSpy: ReturnType<typeof vi.spyOn>;

  async function seedAttempt(userId: string, attemptNumber: number, state: string, sumGrades: number | null): Promise<void> {
    const usageId = uuidv7();
    await pg.query(
      `insert into question_usages (id, component, user_id) values ($1, 'mod_quiz', $2)`,
      [usageId, userId],
    );
    const qaRows: { slot: number; questionId: string; fraction: number | null; state: string }[] = state === 'finished'
      ? [
          { slot: 1, questionId: q1, fraction: 0.5, state: 'graded' },
          { slot: 2, questionId: q2, fraction: 0.5, state: 'graded' },
        ]
      : [
          { slot: 1, questionId: q1, fraction: null, state: 'inprogress' },
          { slot: 2, questionId: q2, fraction: null, state: 'notstarted' },
        ];
    for (const qa of qaRows) {
      await pg.query(
        `insert into question_attempts (id, question_usage_id, slot, question_id, max_mark, state, fraction, user_id)
         values ($1, $2, $3, $4, 5, $5, $6, $7)`,
        [uuidv7(), usageId, qa.slot, qa.questionId, qa.state, qa.fraction, userId],
      );
    }
    await pg.query(
      `insert into exam_attempts (id, pin_id, user_id, attempt_number, usage_id, state, preview, sum_grades, time_start, time_finish)
       values ($1, $2, $3, $4, $5, $6, false, $7, now() - interval '2 hours', now() - interval '1 hour')`,
      [uuidv7(), pinId, userId, attemptNumber, usageId, state, sumGrades],
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    quiz = app.get(QuizService, { strict: false });
    const admin = await adminToken(app);

    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const sectionId = await getFirstSectionId(app, admin, course.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!;
    const teacherUser = await createUserViaApi(app, admin);
    teacherId = teacherUser.id;
    await assignRole(app, admin, teacherUser.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtx.id);
    const teacher = (await login(app, teacherUser.username, STRONG_PASSWORD)).accessToken;

    for (let i = 0; i < 7; i += 1) {
      const student = await createUserViaApi(app, admin);
      await enrolUser(app, admin, course.id, instance.id, student.id);
      if (i < 6) finishedStudentIds.push(student.id); else inprogressOnlyStudentId = student.id;
    }

    await app.get(QuestionBanksService, { strict: false }).ensurePersonalBank(teacherId);
    q1 = await createReadyQuestion(app, teacher, 'Đếm truy vấn kết quả một');
    q2 = await createReadyQuestion(app, teacher, 'Đếm truy vấn kết quả hai');
    const draft = await createExamDraft(app, teacher, 'Đề đếm truy vấn kết quả', 10);
    await addExamSlot(app, teacher, draft, { questionId: q1, maxMark: 5 });
    await addExamSlot(app, teacher, draft, { questionId: q2, maxMark: 5 });
    const pin = await pinExam(app, teacher, course.id, draft, { sectionId });
    pinId = pin.id as string;

    totalsSpy = vi.spyOn(app.get(QuestionsService, { strict: false }), 'usageTotalMaxes');
    totalsQuerySpy = vi.spyOn(app.get(QuestionsRepository, { strict: false }), 'listAttemptsForUsages');
    listAttemptsSpy = vi.spyOn(app.get(QuizRepository, { strict: false }), 'listAttempts');
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  it('số lượt gọi nạp tổng điểm và số truy vấn của một lượt xem trang kết quả không tăng khi số học sinh có lượt đã kết thúc tăng từ 1 lên 6', async () => {
    await seedAttempt(finishedStudentIds[0]!, 1, 'finished', 5);
    totalsSpy.mockClear(); totalsQuerySpy.mockClear(); listAttemptsSpy.mockClear();
    const first = await quiz.getResults(teacherId, pinId);
    const phase1 = {
      usageTotalMaxes: totalsSpy.mock.calls.length,
      listAttemptsForUsages: totalsQuerySpy.mock.calls.length,
      listAttempts: listAttemptsSpy.mock.calls.length,
    };
    expect(first.gradesByUser).toEqual([{ userId: finishedStudentIds[0], grade: 5 }]);

    for (const id of finishedStudentIds.slice(1)) await seedAttempt(id, 1, 'finished', 5);
    await seedAttempt(inprogressOnlyStudentId, 1, 'inprogress', null);
    totalsSpy.mockClear(); totalsQuerySpy.mockClear(); listAttemptsSpy.mockClear();
    const second = await quiz.getResults(teacherId, pinId);
    const phase2 = {
      usageTotalMaxes: totalsSpy.mock.calls.length,
      listAttemptsForUsages: totalsQuerySpy.mock.calls.length,
      listAttempts: listAttemptsSpy.mock.calls.length,
    };

    expect(second.gradesByUser).toHaveLength(7);
    const gradeByUser = new Map(second.gradesByUser.map((g) => [g.userId, g.grade]));
    for (const id of finishedStudentIds) expect(gradeByUser.get(id)).toBe(5);
    expect(gradeByUser.get(inprogressOnlyStudentId)).toBeNull();

    expect(phase1.listAttempts).toBe(1);
    expect(phase2.listAttempts).toBe(1);
    expect(phase1.usageTotalMaxes).toBe(2);
    expect(phase2.usageTotalMaxes).toBe(phase1.usageTotalMaxes);
    expect(phase1.listAttemptsForUsages).toBe(3);
    expect(phase2.listAttemptsForUsages).toBe(phase1.listAttemptsForUsages);
  });
});
