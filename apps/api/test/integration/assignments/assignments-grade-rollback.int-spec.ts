import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { AssignmentsService } from '../../../src/modules/assignments/assignments.service';
import { AssignmentsRepository } from '@giaokhoa/db/repositories/assignments';
import { CompletionService } from '../../../src/modules/completion/completion.service';
import { CompletionRepository } from '@giaokhoa/db/repositories/completion';
import { OutboxService } from '../../../src/infra/events/outbox.service';

const TEST_DB_URL = process.env.GIAOKHOA_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/giaokhoa_test_api';

/**
 * Hồi quy nguyên tử cho ba thao tác ghi nhiều bước của khu vực đánh giá
 * (báo cáo code style 2026-11-13, assessment §2.1).
 *
 * Bất biến nghiệp vụ: mỗi thao tác là một biên nguyên tử — ghi nghiệp vụ
 * và sự kiện outbox hoặc CÙNG thành công, hoặc không bước nào được ghi.
 * Trước bản sửa, chuỗi ghi chạy rời nhau: lỗi ở bước cuối (ghi sự kiện,
 * đổi trạng thái, chèn tiêu chí) để lại dữ liệu dở dang — điểm đã lưu mà
 * sự kiện thì không, bài đã ghi sổ điểm mà trạng thái vẫn nháp, tiêu chí
 * cũ đã xoá mà tiêu chí mới chỉ chèn được một phần.
 *
 * Cách gây lỗi: spy cho bước ghi cuối của mỗi luồng ném lỗi — bước ghi
 * cuối trong transaction. Ca đối chứng khẳng định trạng thái còn lại
 * trong DB sau khi luồng kết thúc: không còn dấu vết nào của lần ghi hỏng.
 *
 * Lưu ý về ranh giới: ghi sổ điểm (GradesService.recordActivityGrade)
 * có transaction riêng của nó nên CHỦ Ý nằm ngoài transaction của
 * assignments — probe trả bài ở dưới chỉ khẳng định trạng thái trả bài
 * và sự kiện của chính nó, không khẳng định sổ điểm.
 */
describe('Chấm và trả bài tập, đặt tiêu chí hoàn thành — rollback nguyên tử khi bước ghi cuối lỗi', () => {
  let app: INestApplication;
  let pg: Client;
  let assignments: AssignmentsService;
  let assignRepo: AssignmentsRepository;
  let completion: CompletionService;
  let completionRepo: CompletionRepository;
  let outbox: OutboxService;

  let course: { id: string };
  let teacherId: string;
  let teacherToken: string;
  let studentId: string;
  let studentToken: string;
  let assignment: { id: string; cmId: string };

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await pg.query<{ count: string }>(sql, params);
    return Number(rows[0]!.count);
  }

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: TEST_DB_URL });
    await pg.connect();
    assignments = app.get(AssignmentsService);
    assignRepo = app.get(AssignmentsRepository);
    completion = app.get(CompletionService);
    completionRepo = app.get(CompletionRepository);
    outbox = app.get(OutboxService);

    const admin = await adminToken(app);
    const cat = await createCategory(app, admin);
    course = await createCourse(app, admin, cat.id);
    const sectionId = await getFirstSectionId(app, admin, course.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!;
    const teacherUser = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacherUser.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtx.id);
    teacherId = teacherUser.id;
    teacherToken = (await login(app, teacherUser.username, STRONG_PASSWORD)).accessToken;

    const student = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, student.id);
    studentId = student.id;
    studentToken = (await login(app, student.username, STRONG_PASSWORD)).accessToken;

    const created = await http(app).post(`/api/v1/courses/${course.id}/assignments`).set('Authorization', `Bearer ${teacherToken}`)
      .send({ sectionId, name: 'Bài tập chụp vở', grade: 10 });
    if (created.status !== 200 && created.status !== 201) throw new Error(`create assignment failed: ${created.status} ${JSON.stringify(created.body)}`);
    assignment = created.body;

    const up = await http(app).post(`/api/v1/assignments/${assignment.id}/submission/files`)
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('file', Buffer.from('anh-bai-lam'), 'bai-lam.jpg');
    expect(up.status).toBe(201);
    const sub = await http(app).post(`/api/v1/assignments/${assignment.id}/submission/submit`).set('Authorization', `Bearer ${studentToken}`);
    expect(sub.status).toBe(201);
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
  });

  it('chấm lỗi ở bước ghi sự kiện thì không còn gói chấm hay sự kiện nào được ghi', async () => {
    const gradesBefore = await count('SELECT count(*) AS count FROM assign_grades WHERE assignment_id = $1 AND user_id = $2', [assignment.id, studentId]);
    const outboxBefore = await count("SELECT count(*) AS count FROM outbox_events WHERE type IN ('assignment_grading_saved', 'assignment_grade_changed')");

    const spy = vi.spyOn(outbox, 'enqueueKysely').mockRejectedValue(new Error('rollback probe'));
    try {
      await expect(assignments.gradeSubmission(teacherId, assignment.id, studentId, { grade: 8 })).rejects.toThrow('rollback probe');
    } finally {
      spy.mockRestore();
    }

    expect(await count('SELECT count(*) AS count FROM assign_grades WHERE assignment_id = $1 AND user_id = $2', [assignment.id, studentId])).toBe(gradesBefore);
    expect(await count("SELECT count(*) AS count FROM outbox_events WHERE type IN ('assignment_grading_saved', 'assignment_grade_changed')")).toBe(outboxBefore);
  });

  it('trả bài lỗi ở bước đổi trạng thái thì gói chấm vẫn nháp và không sự kiện trả bài nào được ghi', async () => {
    // Chấm nháp thành công trước để có gói chấm cần trả.
    await assignments.gradeSubmission(teacherId, assignment.id, studentId, { grade: 8 });
    const draft = await pg.query<{ status: string }>(
      'SELECT status FROM assign_grades WHERE assignment_id = $1 AND user_id = $2',
      [assignment.id, studentId],
    );
    expect(draft.rows[0]!.status).toBe('draft');
    const outboxBefore = await count("SELECT count(*) AS count FROM outbox_events WHERE type IN ('assignment_returned', 'assignment_graded')");

    const spy = vi.spyOn(assignRepo, 'updateGrade').mockRejectedValue(new Error('rollback probe'));
    try {
      await expect(assignments.releaseSubmission(teacherId, assignment.id, studentId)).rejects.toThrow('rollback probe');
    } finally {
      spy.mockRestore();
    }

    const after = await pg.query<{ status: string }>(
      'SELECT status FROM assign_grades WHERE assignment_id = $1 AND user_id = $2',
      [assignment.id, studentId],
    );
    expect(after.rows[0]!.status).toBe('draft');
    expect(await count("SELECT count(*) AS count FROM outbox_events WHERE type IN ('assignment_returned', 'assignment_graded')")).toBe(outboxBefore);
  });

  it('đặt tiêu chí lỗi ở lần chèn thứ hai thì tiêu chí cũ vẫn nguyên và không sự kiện nào được ghi', async () => {
    // Đặt trước một tiêu chí để lần đặt lại sau phải xoá nó đi rồi chèn lại.
    await completion.setCriteria(teacherId, course.id, { criteria: [{ criteriaType: 'self' }] });
    const before = await count('SELECT count(*) AS count FROM course_completion_criteria WHERE course = $1', [course.id]);
    expect(before).toBe(1);
    const outboxBefore = await count("SELECT count(*) AS count FROM outbox_events WHERE type = 'completion_criteria_changed'");

    const realInsert = completionRepo.insertCriteria.bind(completionRepo);
    let calls = 0;
    const spy = vi.spyOn(completionRepo, 'insertCriteria').mockImplementation(async (...args: Parameters<typeof realInsert>) => {
      calls += 1;
      if (calls >= 2) throw new Error('rollback probe');
      return realInsert(...args);
    });
    try {
      await expect(completion.setCriteria(teacherId, course.id, {
        criteria: [{ criteriaType: 'self' }, { criteriaType: 'unenrol' }],
      })).rejects.toThrow('rollback probe');
    } finally {
      spy.mockRestore();
    }

    const rows = await pg.query<{ criteria_type: string }>(
      'SELECT criteria_type FROM course_completion_criteria WHERE course = $1 ORDER BY sort_order ASC',
      [course.id],
    );
    expect(rows.rows.map((r) => r.criteria_type)).toEqual(['self']);
    expect(await count("SELECT count(*) AS count FROM outbox_events WHERE type = 'completion_criteria_changed'")).toBe(outboxBefore);
  });
});
