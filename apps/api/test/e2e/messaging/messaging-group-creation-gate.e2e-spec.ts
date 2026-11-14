import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { join } from 'node:path';
import { buildTestDatabase, dropTestDatabase } from '@giaokhoa/db/test-support';
import { runSpaceProvision, type SpaceProvisionResult } from '../../../src/modules/tenants/space-provision-runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname,
  STRONG_PASSWORD, systemContextId,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { addGroupMember, contextIdByLevelInstance, createGroupViaApi } from '../../support/engagement-helpers';


interface Person { id: string; username: string; token: string }

const suffix = Math.random().toString(36).slice(2, 8);
const centreSlug = `gate-${suffix}`;
const centreHost = `${centreSlug}.test.local`;
const centreUsername = `gatemanager${suffix}`;
const centrePassword = 'GkGateTestDatabase123!';
const controlPlaneDatabase = `giaokhoa_test_cp_gate_${suffix}`;
const migrationDir = join(__dirname, '../../../../../packages/db/migrations/centre');
const actorId = '22222222-2222-4222-8222-222222222222';
const adminDatabaseUrl = new URL(process.env.DATABASE_URL!);
adminDatabaseUrl.pathname = '/postgres';
const adminUrl = adminDatabaseUrl.toString();

function centreUrl(centre: SpaceProvisionResult): string {
  const url = new URL(adminUrl);
  url.pathname = `/${centre.databaseName}`;
  url.username = centre.connectionRole;
  url.password = centrePassword;
  return url.toString();
}

describe('Messaging — cổng tạo nhóm tự do chỉ dành cho quản trị viên và chủ trung tâm (issue #563)', () => {
  let app: INestApplication;
  let centre: SpaceProvisionResult;
  const previousControlPlaneUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  let admin: string;
  let adminId: string;
  let teacher: Person;
  let staff: Person;
  let platformManager: Person;
  let student: Person;
  let member: Person;
  let owner: Person;
  let centreMember: Person;
  let ownerCentreToken: string;
  let courseGroupId: string;

  async function person(): Promise<Person> {
    const u = await createUserViaApi(app, admin);
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function createFreeGroup(token: string, memberIds: string[], host?: string) {
    const req = http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${token}`);
    if (host) req.set('Host', host);
    return req.send({ type: 2, memberIds, name: 'Nhóm kiểm cổng tạo nhóm' });
  }

  beforeAll(async () => {
    const controlPlaneUrl = await buildTestDatabase({
      adminUrl, database: controlPlaneDatabase, store: 'control-plane',
    });
    centre = await runSpaceProvision({
      slug: centreSlug, name: 'Trung tâm kiểm quyền tạo nhóm',
      adminEmail: `gate-${suffix}@example.com`, adminUsername: centreUsername,
      databasePassword: centrePassword, actorId, migrationsDir: migrationDir,
      env: { ...process.env, CONTROL_PLANE_DATABASE_URL: controlPlaneUrl }, log: () => undefined,
    });
    process.env.CONTROL_PLANE_DATABASE_URL = controlPlaneUrl;
    process.env[centre.secretEnvVar] = centreUrl(centre);
    app = await createTestApp();
    admin = await adminToken(app);
    adminId = (await login(app, 'admin', 'Admin123!')).userId;

    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    teacher = await person();
    student = await person();
    member = await person();
    const courseCtx = await contextIdByLevelInstance(app, admin, 50, course.id);
    const editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');
    await assignRole(app, admin, teacher.id, editingTeacher, courseCtx);
    await enrolUser(app, admin, course.id, instance.id, student.id);
    await enrolUser(app, admin, course.id, instance.id, member.id);

    staff = await person();
    const systemCtx = await systemContextId(app, admin);
    const courseCreator = await roleIdByShortname(app, admin, 'coursecreator');
    await assignRole(app, admin, staff.id, courseCreator, systemCtx);

    platformManager = await person();
    const managerRoleAtSystem = await roleIdByShortname(app, admin, 'manager');
    await assignRole(app, admin, platformManager.id, managerRoleAtSystem, systemCtx);

    const group = await createGroupViaApi(app, admin, course.id, 'Tổ kiểm cổng');
    courseGroupId = group.id;
    await addGroupMember(app, admin, course.id, group.id, student.id);
    await addGroupMember(app, admin, course.id, group.id, member.id);

    const activated = await http(app).post('/api/v1/centres/activate-invite')
      .send({ slug: centreSlug, token: centre.inviteToken, password: STRONG_PASSWORD });
    expect(activated.status, JSON.stringify(activated.body)).toBe(201);
    const ownerLogin = await http(app).post('/api/v1/auth/token').set('Host', centreHost)
      .send({ username: centreUsername, password: STRONG_PASSWORD });
    expect(ownerLogin.status, JSON.stringify(ownerLogin.body)).toBe(201);
    ownerCentreToken = ownerLogin.body.accessToken as string;
    owner = { id: centre.adminUserId!, username: centreUsername, token: ownerCentreToken };
    const memberUsername = `gatemember${suffix}`;
    const createdMember = await http(app).post(`/api/v1/tenants/${centre.tenantId}/users`)
      .set('Host', centreHost).set('Authorization', `Bearer ${ownerCentreToken}`)
      .send({ username: memberUsername, email: `${memberUsername}@example.com`,
        password: STRONG_PASSWORD, firstName: 'Học', lastName: 'Viên' });
    expect(createdMember.status, JSON.stringify(createdMember.body)).toBe(201);
    centreMember = { id: createdMember.body.id as string, username: memberUsername, token: '' };
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    if (centre) {
      delete process.env[centre.secretEnvVar];
      const admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${centre.databaseName}" WITH (FORCE)`);
        await admin.query(`DROP ROLE IF EXISTS "${centre.connectionRole}"`);
      } finally {
        await admin.end();
      }
    }
    if (previousControlPlaneUrl === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL;
    else process.env.CONTROL_PLANE_DATABASE_URL = previousControlPlaneUrl;
    await dropTestDatabase(adminUrl, controlPlaneDatabase);
  });

  it('giáo viên có gán vai giảng dạy tại context khoá bị từ chối tạo nhóm tự do với mã messaging.group_creation_forbidden', async () => {
    const res = await createFreeGroup(teacher.token, [student.id, member.id]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('messaging.group_creation_forbidden');
  });

  it('nhân viên có gán vai staff tại context hệ thống bị từ chối tạo nhóm tự do với mã messaging.group_creation_forbidden', async () => {
    const res = await createFreeGroup(staff.token, [student.id, member.id]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('messaging.group_creation_forbidden');
  });

  it('học viên đang ghi danh khoá bị từ chối tạo nhóm tự do với mã messaging.group_creation_forbidden', async () => {
    const res = await createFreeGroup(student.token, [teacher.id, member.id]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('messaging.group_creation_forbidden');
  });

  it('quản trị viên hệ thống tạo được nhóm tự do và thành viên đúng như khai', async () => {
    const res = await createFreeGroup(admin, [student.id, member.id]);
    expect(res.status).toBe(201);
    expect(new Set(res.body.members as string[])).toEqual(new Set([adminId, student.id, member.id]));
    expect(res.body.createdBy).toBe(adminId);
  });

  it('chủ trung tâm tạo được nhóm tự do trong tenant của mình với phiên đã chuyển vào tenant đó', async () => {
    const res = await createFreeGroup(ownerCentreToken, [centreMember.id], centreHost);
    expect(res.status).toBe(201);
    expect(new Set(res.body.members as string[])).toEqual(new Set([owner.id, centreMember.id]));
    expect(res.body.createdBy).toBe(owner.id);
  });

  it('quản trị viên nền tảng giữ tenant:manage tại context hệ thống (không phải site admin, không phải thành viên tenant) tạo được nhóm tự do', async () => {
    const res = await createFreeGroup(platformManager.token, [student.id, member.id]);
    expect(res.status).toBe(201);
    expect(new Set(res.body.members as string[])).toEqual(new Set([platformManager.id, student.id, member.id]));
    expect(res.body.createdBy).toBe(platformManager.id);
  });

  it('đường cấu trúc không bị ảnh hưởng: thành viên nhóm con của khoá vẫn tạo được conversation của nhóm', async () => {
    const res = await http(app).post('/api/v1/messages/conversations/group')
      .set('Authorization', `Bearer ${student.token}`).send({ groupId: courseGroupId });
    expect(res.status).toBe(201);
    expect(new Set(res.body.members as string[])).toEqual(new Set([student.id, member.id]));
  });

  it('cờ canCreateFreeGroup trên cây nhóm khớp cổng tạo nhóm: quản trị viên, chủ trung tâm và quản trị nền tảng true; giáo viên, nhân viên và học viên false', async () => {
    const flagOf = async (token: string, host?: string) => {
      const req = http(app).get('/api/v1/messages/group-tree').set('Authorization', `Bearer ${token}`);
      if (host) req.set('Host', host);
      const res = await req;
      expect(res.status).toBe(200);
      return (res.body as { canCreateFreeGroup: boolean }).canCreateFreeGroup;
    };
    expect(await flagOf(teacher.token)).toBe(false);
    expect(await flagOf(staff.token)).toBe(false);
    expect(await flagOf(student.token)).toBe(false);
    expect(await flagOf(admin)).toBe(true);
    expect(await flagOf(ownerCentreToken, centreHost)).toBe(true);
    expect(await flagOf(platformManager.token)).toBe(true);
  });

  it('hội thoại 1-1 qua cổng liên lạc không hồi quy: kết bạn xong vẫn mở được conversation riêng', async () => {
    const a = await person();
    const b = await person();
    const req = await http(app).post(`/api/v1/messages/contacts/${b.id}`).set('Authorization', `Bearer ${a.token}`).send({});
    expect(req.status).toBe(201);
    const acc = await http(app).post(`/api/v1/messages/contacts/requests/${a.id}/accept`).set('Authorization', `Bearer ${b.token}`).send({});
    expect(acc.status).toBe(201);
    const conv = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${a.token}`)
      .send({ type: 1, memberIds: [b.id] });
    expect(conv.status).toBe(201);
    expect(new Set(conv.body.members as string[])).toEqual(new Set([a.id, b.id]));
  });
});
