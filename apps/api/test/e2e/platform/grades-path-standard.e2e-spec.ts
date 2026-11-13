import { Logger, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminToken, createTestApp, createUserViaApi, http } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { createGradeItem, setGrade } from '../../support/assessment-helpers';

describe('Chuẩn đường dẫn điểm (issue #342)', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });



  it('phục vụ alias cũ kèm header deprecation và log có cấu trúc trong khi route chuẩn không bị đánh dấu', async () => {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    const student = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, student.id);
    const item = await createGradeItem(app, admin, course.id, { itemName: 'Path standard item', gradeMax: 10 });
    await setGrade(app, admin, item.id, student.id, 8);

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const aliasList = await http(app).get(`/api/v1/courses/${course.id}/grades/items`).set('Authorization', `Bearer ${admin}`);
    expect(aliasList.status).toBe(200);
    expect(aliasList.headers['deprecation']).toBe('true');
    expect(aliasList.headers['sunset']).toContain('2027');

    const aliasSetGrade = await http(app).post(`/api/v1/courses/grades/items/${item.id}/grades`).set('Authorization', `Bearer ${admin}`)
      .send({ userId: student.id, rawGrade: 7 });
    expect(aliasSetGrade.status).toBeLessThan(300);
    expect(aliasSetGrade.headers['deprecation']).toBe('true');

    const canonicalList = await http(app).get(`/api/v1/courses/${course.id}/grade-items`).set('Authorization', `Bearer ${admin}`);
    expect(canonicalList.status).toBe(200);
    expect(canonicalList.headers['deprecation']).toBeUndefined();

    const aliasExport = await http(app).post(`/api/v1/courses/${course.id}/grades/export/vnedu`).set('Authorization', `Bearer ${admin}`)
      .send({});
    expect(aliasExport.status).toBe(400);
    expect(aliasExport.headers['deprecation']).toBe('true');

    const aliasLogs = warn.mock.calls
      .map((call) => String(call[0]))
      .flatMap((message) => {
        try {
          return [JSON.parse(message) as Record<string, unknown>];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry.event === 'deprecated_route_alias');
    expect(aliasLogs.length).toBeGreaterThanOrEqual(1);
    expect(aliasLogs.some((entry) => entry.alias === 'courses/:courseId/grades/items')).toBe(true);
  });
});
