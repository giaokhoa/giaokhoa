import { Logger, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminToken, createTestApp, createUserViaApi, http, uniqueName } from '../../support/identity-access-helpers';
import { createCategory, createCm, createCourse, createSection } from '../../support/course-enrolment-helpers';

describe('Chuẩn đường dẫn action (issue #345)', () => {
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
    const badgeRes = await http(app).post('/api/v1/badges').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Alias probe badge', type: 1 });
    expect(badgeRes.status).toBe(201);
    const badgeId = badgeRes.body.id as string;

    const fwRes = await http(app).post('/api/v1/competencies/frameworks').set('Authorization', `Bearer ${admin}`)
      .send({ shortName: `FW alias ${uniqueName('fw')}`, scale: { values: ['Not competent', 'Competent'], proficient: [1] } });
    expect(fwRes.status).toBe(201);
    const frameworkId = fwRes.body.id as string;

    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const section = await createSection(app, admin, course.id, { name: 'Alias section' });
    const cm = await createCm(app, admin, course.id, section.id, { name: 'Alias module' });

    const user = await createUserViaApi(app, admin);
    const suspended = await http(app).post(`/api/v1/users/${user.id}/suspend`).set('Authorization', `Bearer ${admin}`);
    expect(suspended.status).toBeLessThan(300);

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const aliasBadge = await http(app).post(`/api/v1/badges/${badgeId}/duplicate`).set('Authorization', `Bearer ${admin}`).send({});
    expect(aliasBadge.status).toBe(201);
    expect(aliasBadge.body.id).not.toBe(badgeId);
    expect(aliasBadge.headers['deprecation']).toBe('true');
    expect(aliasBadge.headers['sunset']).toContain('2027');

    const canonicalBadge = await http(app).post(`/api/v1/badges/${badgeId}/copy`).set('Authorization', `Bearer ${admin}`).send({});
    expect(canonicalBadge.status).toBe(201);
    expect(canonicalBadge.headers['deprecation']).toBeUndefined();

    const aliasFramework = await http(app).post(`/api/v1/competencies/frameworks/${frameworkId}/duplicate`).set('Authorization', `Bearer ${admin}`).send({});
    expect(aliasFramework.status).toBe(201);
    expect(aliasFramework.body.id).not.toBe(frameworkId);
    expect(aliasFramework.headers['deprecation']).toBe('true');

    const aliasCourse = await http(app).post(`/api/v1/courses/${course.id}/duplicate`).set('Authorization', `Bearer ${admin}`)
      .send({ fullName: 'Alias course copy', shortName: uniqueName('alias') });
    expect(aliasCourse.status).toBe(201);
    expect(aliasCourse.headers['deprecation']).toBe('true');

    const canonicalCourse = await http(app).post(`/api/v1/courses/${course.id}/copy`).set('Authorization', `Bearer ${admin}`)
      .send({ fullName: 'Canonical course copy', shortName: uniqueName('canon') });
    expect(canonicalCourse.status).toBe(201);
    expect(canonicalCourse.headers['deprecation']).toBeUndefined();

    const aliasSection = await http(app).post(`/api/v1/courses/${course.id}/sections/${section.id}/duplicate`).set('Authorization', `Bearer ${admin}`).send({});
    expect(aliasSection.status).toBe(201);
    expect(aliasSection.headers['deprecation']).toBe('true');

    const aliasCm = await http(app).post(`/api/v1/courses/${course.id}/modules/${cm.id}/duplicate`).set('Authorization', `Bearer ${admin}`).send({});
    expect(aliasCm.status).toBe(201);
    expect(aliasCm.headers['deprecation']).toBe('true');

    const aliasUnsuspend = await http(app).post(`/api/v1/users/${user.id}/unsuspend`).set('Authorization', `Bearer ${admin}`);
    expect(aliasUnsuspend.status).toBeLessThan(300);
    expect(aliasUnsuspend.body.suspended).toBe(false);
    expect(aliasUnsuspend.headers['deprecation']).toBe('true');

    await http(app).post(`/api/v1/users/${user.id}/suspend`).set('Authorization', `Bearer ${admin}`);
    const canonicalReactivate = await http(app).post(`/api/v1/users/${user.id}/reactivate`).set('Authorization', `Bearer ${admin}`);
    expect(canonicalReactivate.status).toBeLessThan(300);
    expect(canonicalReactivate.body.suspended).toBe(false);
    expect(canonicalReactivate.headers['deprecation']).toBeUndefined();

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
    const loggedPairs = new Set(aliasLogs.map((entry) => `${entry.alias} -> ${entry.canonical}`));
    expect(loggedPairs).toContain('badges/:id/duplicate -> badges/:id/copy');
    expect(loggedPairs).toContain('competencies/frameworks/:id/duplicate -> competencies/frameworks/:id/copy');
    expect(loggedPairs).toContain('courses/:id/duplicate -> courses/:id/copy');
    expect(loggedPairs).toContain('courses/:id/sections/:sectionId/duplicate -> courses/:id/sections/:sectionId/copy');
    expect(loggedPairs).toContain('courses/:id/modules/:cmId/duplicate -> courses/:id/modules/:cmId/copy');
    expect(loggedPairs).toContain('users/:id/unsuspend -> users/:id/reactivate');
  });

  it('phục vụ đích xuất file với format dạng dữ liệu request và nội dung giống hệt trên alias và chuẩn', async () => {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const aliasIcs = await http(app).get('/api/v1/calendar/export.ics').set('Authorization', `Bearer ${admin}`);
    expect(aliasIcs.status).toBe(200);
    expect(aliasIcs.headers['content-type']).toContain('text/calendar');
    expect(aliasIcs.headers['deprecation']).toBe('true');
    expect(aliasIcs.headers['sunset']).toContain('2027');

    const canonicalIcs = await http(app).get('/api/v1/calendar/exports?format=ics').set('Authorization', `Bearer ${admin}`);
    expect(canonicalIcs.status).toBe(200);
    expect(canonicalIcs.headers['content-type']).toContain('text/calendar');
    expect(canonicalIcs.headers['deprecation']).toBeUndefined();
    expect(canonicalIcs.text).toContain('BEGIN:VCALENDAR');

    const badFormat = await http(app).get('/api/v1/calendar/exports?format=pdf').set('Authorization', `Bearer ${admin}`);
    expect(badFormat.status).toBe(400);
    expect((badFormat.body as { code?: string }).code).toBe('calendar.export_format_unsupported');

    const aliasCsv = await http(app).get(`/api/v1/courses/${course.id}/progress/report.csv`).set('Authorization', `Bearer ${admin}`);
    const canonicalCsv = await http(app).get(`/api/v1/courses/${course.id}/progress/reports?format=csv`).set('Authorization', `Bearer ${admin}`);
    expect(aliasCsv.status).toBe(canonicalCsv.status);
    expect(aliasCsv.text).toBe(canonicalCsv.text);
    expect(aliasCsv.headers['deprecation']).toBe('true');
    expect(canonicalCsv.headers['deprecation']).toBeUndefined();

    const badReportFormat = await http(app).get(`/api/v1/courses/${course.id}/progress/reports?format=xlsx`).set('Authorization', `Bearer ${admin}`);
    expect(badReportFormat.status).toBe(400);
    expect((badReportFormat.body as { code?: string }).code).toBe('content.progress_report_format_unsupported');

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
    const loggedPairs = new Set(aliasLogs.map((entry) => `${entry.alias} -> ${entry.canonical}`));
    expect(loggedPairs).toContain('calendar/export.ics -> calendar/exports?format=ics');
    expect(loggedPairs).toContain('courses/:courseId/progress/report.csv -> courses/:courseId/progress/reports?format=csv');
  });


});
