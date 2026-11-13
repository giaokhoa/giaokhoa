import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';

describe('Ghi đè thông báo theo khoá (NB-4, issue #174)', () => {
  let app: INestApplication;
  let admin: string;
  let pg: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  interface CourseOverrideRow { courseId: string; courseName: string; mode: string }

  async function overridesOf(token: string): Promise<CourseOverrideRow[]> {
    const res = await http(app).get('/api/v1/messages/preferences/courses').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { courses: CourseOverrideRow[] }).courses;
  }

  async function setOverride(token: string, courseId: string, mode: string) {
    return http(app).put('/api/v1/messages/preferences/courses')
      .set('Authorization', `Bearer ${token}`).send({ courseId, mode });
  }

  async function setupStudentInTwoCourses() {
    const cat = await createCategory(app, admin);
    const courseA = await createCourse(app, admin, cat.id);
    const courseB = await createCourse(app, admin, cat.id);
    const student = await createUserViaApi(app, admin);
    for (const course of [courseA, courseB]) {
      const instance = await createEnrolInstance(app, admin, course.id);
      await enrolUser(app, admin, course.id, instance.id, student.id);
    }
    const token = (await login(app, student.username, STRONG_PASSWORD)).accessToken;
    return { courseA, courseB, student, token };
  }

  it('GET liệt kê khoá học của tôi dạng all mặc định; PUT mute lưu tuỳ chọn notif.course.<id>; khoá lạ 404; mode sai 400', async () => {
    const { courseA, courseB, student, token } = await setupStudentInTwoCourses();

    const initial = await overridesOf(token);
    expect(initial.map((c) => c.courseId).sort()).toEqual([courseA.id, courseB.id].sort());
    for (const row of initial) expect(row.mode).toBe('all');
    expect(initial.find((c) => c.courseId === courseA.id)?.courseName).toBe(courseA.fullName);

    const put = await setOverride(token, courseA.id, 'mute');
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ courseId: courseA.id, mode: 'mute' });

    const stored = await pg.query(
      `select value from user_preferences where user_id = $1 and name = $2`,
      [student.id, `notif.course.${courseA.id}`],
    );
    expect(stored.rows).toEqual([{ value: 'mute' }]);

    const after = await overridesOf(token);
    expect(after.find((c) => c.courseId === courseA.id)?.mode).toBe('mute');
    expect(after.find((c) => c.courseId === courseB.id)?.mode).toBe('all');

    const foreign = await setOverride(token, randomUUID(), 'mute');
    expect(foreign.status).toBe(404);

    const badMode = await setOverride(token, courseA.id, 'sometimes');
    expect(badMode.status).toBe(400);

    const outsider = await createUserViaApi(app, admin);
    const outsiderToken = (await login(app, outsider.username, STRONG_PASSWORD)).accessToken;
    expect(await overridesOf(outsiderToken)).toEqual([]);
  });
});
