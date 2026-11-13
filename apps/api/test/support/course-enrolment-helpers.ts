import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { http, uniqueName } from './identity-access-helpers';

export async function createCategory(app: INestApplication, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string; parent: string; path: string; depth: number }> {  const name = uniqueName('cat');
  const res = await http(app).post('/api/v1/courses/categories').set('Authorization', `Bearer ${token}`)
    .send({ name, ...overrides });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create category failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createClass(app: INestApplication, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = uniqueName('cls');
  const res = await http(app).post('/api/v1/classes').set('Authorization', `Bearer ${token}`)
    .send({ name, ...overrides });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create class failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const fixtureClassByToken = new WeakMap<INestApplication, Map<string, Promise<string>>>();

export function fixtureClassId(app: INestApplication, token: string): Promise<string> {
  let byToken = fixtureClassByToken.get(app);
  if (!byToken) {
    byToken = new Map();
    fixtureClassByToken.set(app, byToken);
  }
  let pending = byToken.get(token);
  if (!pending) {
    pending = createClass(app, token).then((c) => c.id);
    byToken.set(token, pending);
  }
  return pending;
}

export async function createCourse(app: INestApplication, token: string, category: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; fullName: string; shortName: string; category: string; classId: string | null }> {
  const shortName = uniqueName('crs');
  const withClass = 'classId' in overrides ? overrides : { ...overrides, classId: await fixtureClassId(app, token) };
  const res = await http(app).post('/api/v1/courses').set('Authorization', `Bearer ${token}`)
    .send({ fullName: `Course ${shortName}`, shortName, category, ...withClass });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create course failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createSection(app: INestApplication, token: string, courseId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; section: number }> {
  const res = await http(app).post(`/api/v1/courses/${courseId}/sections`).set('Authorization', `Bearer ${token}`).send(overrides);
  if (res.status !== 200 && res.status !== 201) throw new Error(`create section failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function getFirstSectionId(app: INestApplication, token: string, courseId: string): Promise<string> {
  const res = await http(app).get(`/api/v1/courses/${courseId}/content`).set('Authorization', `Bearer ${token}`);
  if (res.status !== 200) throw new Error(`content failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.sections[0].id as string;
}

export async function createCm(app: INestApplication, token: string, courseId: string, sectionId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; contextId?: string }> {
  const res = await http(app).post(`/api/v1/courses/${courseId}/modules`).set('Authorization', `Bearer ${token}`)
    .send({ sectionId, component: 'mod_page', name: 'A page', ...overrides });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create cm failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createEnrolInstance(app: INestApplication, token: string, courseId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; enrol: string }> {
  const res = await http(app).post(`/api/v1/courses/${courseId}/enrol/instances`).set('Authorization', `Bearer ${token}`)
    .send({ method: 'manual', ...overrides });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create enrol instance failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function enrolUser(app: INestApplication, token: string, courseId: string, instanceId: string, userId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; status: number }> {
  const res = await http(app).post(`/api/v1/courses/${courseId}/enrol/instances/${instanceId}/enrol`).set('Authorization', `Bearer ${token}`)
    .send({ userId, ...overrides });
  if (res.status !== 200 && res.status !== 201) throw new Error(`enrol failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function grantActiveTeacherPlan(pg: Client, userId: string): Promise<void> {
  const tz = await pg.query<{ id: string }>("select id from tenants where kind = 'platform'");
  const tenantId = tz.rows[0]!.id;
  const acc = await pg.query<{ id: string }>(
    "insert into payment_accounts (tenant_id, name, gateway, enabled) values ($1, 'Fixture teacher plan account', 'manual', false) returning id",
    [tenantId],
  );
  const pay = await pg.query<{ id: string }>(
    `insert into payments (tenant_id, account_id, user_id, amount, currency, component, item_id, status)
     values ($1, $2, $3, 990000, 'VND', 'teacher_plan', $3, 'succeeded') returning id`,
    [tenantId, acc.rows[0]!.id, userId],
  );
  await pg.query(
    `insert into plan_entitlements (tenant_id, user_id, component, payment_id, starts_at, expires_at, status)
     values ($1, $2, 'teacher_plan', $3, now() - interval '1 day', now() + interval '364 days', 'active')`,
    [tenantId, userId, pay.rows[0]!.id],
  );
}
