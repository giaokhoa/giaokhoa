import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_DEFINITIONS } from '../../../src/modules/access/domain/capabilities';
import {
  adminToken, assignRole, createContextViaApi, createRoleViaApi, createTestApp, createUserViaApi,
  hasCapability, http, login, roleIdByShortname, setOverride, STRONG_PASSWORD, systemContextId, uniqueName,
  seedTenantMembershipFixture,
} from '../../support/identity-access-helpers';
import { EXPECTED_SNAPSHOTS } from '../../support/users-my-access-snapshot.fixture';

describe('Người dùng: tương đương phân giải batch my-access', () => {
  let app: INestApplication;
  let admin: string;
  let adminId: string;
  const contextLabels = new Map<string, string>();
  const tokens = new Map<string, string>();
  let customRoleShortname = '';

  async function addUser(key: string): Promise<{ id: string; username: string }> {
    const created = await createUserViaApi(app, admin);
    const { accessToken } = await login(app, created.username, STRONG_PASSWORD);
    tokens.set(key, accessToken);
    return created;
  }

  async function snapshotOf(key: string) {
    const res = await http(app).get('/api/v1/users/me/capabilities').set('Authorization', `Bearer ${tokens.get(key)}`);
    expect(res.status).toBe(200);
    return res.body as {
      userId: string; isSiteAdmin: boolean; hasLearnerArtifacts: boolean;
      assignments: { roleShortname: string; contextId: string }[];
      contexts: { contextId: string; contextLevel: number; capabilities: string[] }[];
    };
  }

  function normalize(body: Awaited<ReturnType<typeof snapshotOf>>) {
    return {
      isSiteAdmin: body.isSiteAdmin,
      hasLearnerArtifacts: body.hasLearnerArtifacts,
      assignments: body.assignments
        .map((a) => ({
          role: a.roleShortname === customRoleShortname ? 'customrole' : a.roleShortname,
          context: contextLabels.get(a.contextId) ?? a.contextId,
        }))
        .sort((x, y) => `${x.role}@${x.context}`.localeCompare(`${y.role}@${y.context}`)),
      contexts: body.contexts
        .map((c) => ({ context: contextLabels.get(c.contextId) ?? c.contextId, level: c.contextLevel, capabilities: c.capabilities }))
        .sort((x, y) => x.context.localeCompare(y.context)),
    };
  }

  async function oracleCapabilities(userId: string, contextId: string): Promise<string[]> {
    const granted: string[] = [];
    for (const def of CAPABILITY_DEFINITIONS) {
      if (await hasCapability(app, admin, userId, def.name, contextId)) granted.push(def.name);
    }
    return granted;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    adminId = (await login(app, 'admin', 'Admin123!')).userId;
    const systemId = await systemContextId(app, admin);
    contextLabels.set(systemId, 'system');

    const coursecat = await createContextViaApi(app, admin, 40, randomUUID(), systemId);
    contextLabels.set(coursecat.id, 'coursecat');
    const course = await createContextViaApi(app, admin, 50, randomUUID(), coursecat.id);
    contextLabels.set(course.id, 'course');
    const course2 = await createContextViaApi(app, admin, 50, randomUUID(), coursecat.id);
    contextLabels.set(course2.id, 'course2');
    const klass = await createContextViaApi(app, admin, 45, randomUUID(), systemId);
    contextLabels.set(klass.id, 'class');

    const customRole = await createRoleViaApi(app, admin);
    const rolesRes = await http(app).get('/api/v1/access/roles').set('Authorization', `Bearer ${admin}`);
    customRoleShortname = (rolesRes.body as { id: string; shortName: string }[]).find((r) => r.id === customRole)?.shortName ?? '';
    await setOverride(app, admin, customRole, 'question:add', systemId, 1);
    await setOverride(app, admin, customRole, 'question:add', coursecat.id, -1);
    await setOverride(app, admin, customRole, 'question:add', course.id, 1);
    await setOverride(app, admin, customRole, 'site:config', systemId, 1);
    await setOverride(app, admin, customRole, 'site:config', course.id, -1000);
    await setOverride(app, admin, customRole, 'course:view', klass.id, 1);

    const editingteacher = await roleIdByShortname(app, admin, 'editingteacher');
    const teacher = await roleIdByShortname(app, admin, 'teacher');
    const student = await roleIdByShortname(app, admin, 'student');

    const teacherMulti = await addUser('teacherMulti');
    await assignRole(app, admin, teacherMulti.id, editingteacher, course.id);
    await assignRole(app, admin, teacherMulti.id, customRole, course.id);
    await assignRole(app, admin, teacherMulti.id, customRole, klass.id);
    await assignRole(app, admin, teacherMulti.id, teacher, klass.id);

    const teacherOne = await addUser('teacherOne');
    await assignRole(app, admin, teacherOne.id, editingteacher, course2.id);

    const studentPlain = await addUser('studentPlain');
    await assignRole(app, admin, studentPlain.id, student, systemId);

    await addUser('plainUser');

    const slug = uniqueName('tenant').toLowerCase();
    const tenantRes = await http(app).post('/api/v1/tenants').set('Authorization', `Bearer ${admin}`)
      .send({ slug, name: `Trường ${slug}`, kind: 'school' });
    expect([200, 201]).toContain(tenantRes.status);
    const tenantId = (tenantRes.body as { id: string }).id;
    const contextsRes = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const tenantCtx = (contextsRes.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 20 && c.instanceId === tenantId);
    expect(tenantCtx).toBeDefined();
    contextLabels.set(tenantCtx!.id, 'tenant');
    const tenantCourse = await createContextViaApi(app, admin, 50, randomUUID(), tenantCtx!.id);
    contextLabels.set(tenantCourse.id, 'tenantCourse');

    const member = await addUser('tenantMember');
    await assignRole(app, admin, member.id, customRole, tenantCourse.id);
    await assignRole(app, admin, member.id, customRole, systemId);
    await seedTenantMembershipFixture(app, tenantId, member.id);

    const outsider = await addUser('tenantOutsider');
    await assignRole(app, admin, outsider.id, customRole, tenantCourse.id);

    tokens.set('admin', admin);
    await assignRole(app, admin, adminId, customRole, tenantCourse.id);
    (globalThis as Record<string, unknown>).__perfTenant = { tenantId, tenantCourseId: tenantCourse.id, tenantCtxId: tenantCtx!.id, memberId: member.id, outsiderId: outsider.id };
  }, 300000);

  afterAll(async () => { await app.close(); });

  it('tái tạo đúng từng trường snapshot trước-thay-đổi đã ghi cho các vai mẫu', async () => {
    for (const key of ['teacherMulti', 'teacherOne', 'studentPlain', 'plainUser'] as const) {
      const normalized = normalize(await snapshotOf(key));
      expect(normalized, `snapshot mismatch for ${key}`).toEqual(EXPECTED_SNAPSHOTS[key]);
    }
  }, 120000);

  it('khớp oracle has-capability cũ trên mọi năng lực tại ngữ cảnh nhạy cảm', async () => {
    const teacherMulti = normalize(await snapshotOf('teacherMulti'));
    const userIds = new Map<string, string>();
    for (const key of ['teacherMulti', 'studentPlain']) {
      const res = await http(app).get('/api/v1/users/me/capabilities').set('Authorization', `Bearer ${tokens.get(key)}`);
      userIds.set(key, (res.body as { userId: string }).userId);
    }
    const byLabel = new Map(teacherMulti.contexts.map((c) => [c.context, c]));
    const labelToId = new Map([...contextLabels.entries()].map(([id, label]) => [label, id]));
    for (const label of ['course', 'system', 'class', 'coursecat']) {
      const oracle = await oracleCapabilities(userIds.get('teacherMulti')!, labelToId.get(label)!);
      expect(byLabel.get(label)!.capabilities, `oracle mismatch teacherMulti @ ${label}`).toEqual(oracle);
    }
    const student = normalize(await snapshotOf('studentPlain'));
    const studentSystem = student.contexts.find((c) => c.context === 'system')!;
    expect(studentSystem.capabilities).toEqual(await oracleCapabilities(userIds.get('studentPlain')!, labelToId.get('system')!));
  }, 600000);

  it('áp cổng tenant trong snapshot đúng như đường cũ', async () => {
    const t = (globalThis as Record<string, unknown>).__perfTenant as {
      tenantId: string; tenantCourseId: string; tenantCtxId: string; memberId: string; outsiderId: string;
    };
    const outsider = await snapshotOf('tenantOutsider');
    expect(outsider.contexts.find((c) => c.contextId === t.tenantCourseId)?.capabilities).toEqual([]);
    expect(outsider.contexts.find((c) => c.contextId === t.tenantCtxId)?.capabilities).toEqual([]);

    const member = await snapshotOf('tenantMember');
    const memberCourse = member.contexts.find((c) => c.contextId === t.tenantCourseId)!;
    expect(memberCourse.capabilities).toEqual(await oracleCapabilities(t.memberId, t.tenantCourseId));
    const memberSystem = member.contexts.find((c) => c.contextLevel === 10)!;
    expect(memberSystem.capabilities).toContain('question:add');

    const adminBefore = await snapshotOf('admin');
    expect(adminBefore.contexts.find((c) => c.contextId === t.tenantCourseId)?.capabilities).toEqual([]);
    await seedTenantMembershipFixture(app, t.tenantId, adminId);
    const adminAfter = await snapshotOf('admin');
    const adminCourse = adminAfter.contexts.find((c) => c.contextId === t.tenantCourseId)!;
    expect(adminCourse.capabilities).toEqual(await oracleCapabilities(adminId, t.tenantCourseId));
    expect(adminCourse.capabilities.length).toBeLessThan(CAPABILITY_DEFINITIONS.length);
    expect(adminCourse.capabilities.length).toBeGreaterThan(0);
  }, 600000);
});
