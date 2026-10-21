import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import {
  authzCapabilities,
  authzRoleAssignments,
  authzRolePermissions,
  authzRoles,
} from '@giaokhoa/database/schema';
import { users } from '@giaokhoa/database/schema';
import { classEnrolments } from '@giaokhoa/database/schema';
import * as schema from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';

const testDatabaseName = `giaokhoa_authz_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const systemRef = { kind: 'system' as const, resourceKey: 'giaokhoa' };

let pool: Pool;
let db: Database;
let repository: PostgresAuthorizationRepository;
let service: AuthorizationService;
let systemId: string;

function databaseUrl(databaseName: string) {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required for authorization e2e tests');
  const url = new URL(value);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withAdminConnection<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl('postgres') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createUser(label: string, role: 'user' | 'teacher' | 'admin' = 'user') {
  const [created] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${randomUUID()}@example.com`,
      role,
    })
    .returning();
  return created;
}

async function createClass(ownerId: string, key: string) {
  const classroom = await new PostgresClassesRepository(db).create(
    { name: key, joinMode: 'AUTO' },
    ownerId,
  );
  const context = await repository.findContext({ kind: 'class', resourceKey: classroom.id });
  if (!context) throw new Error('Class context missing after creation');
  return context;
}

function can(actorId: string, capability: string, kind: 'system' | 'class', resourceKey: string) {
  return service.authorize({ actorId, capability, context: { kind, resourceKey } });
}

beforeAll(async () => {
  await withAdminConnection((client) => client.query(`CREATE DATABASE "${testDatabaseName}"`));
  pool = new Pool({ connectionString: databaseUrl(testDatabaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  repository = new PostgresAuthorizationRepository(db);
  service = new AuthorizationService(repository);
  const system = await repository.findContext(systemRef);
  if (!system) throw new Error('System context seed is missing');
  systemId = system.id;
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await withAdminConnection((client) =>
    client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
  );
}, 30_000);

describe('Migration, dữ liệu khởi tạo và kho phân quyền', () => {
  it('khởi tạo mẫu quyền và đọc vai trò chuẩn của người dùng, không tạo sai lệch phân quyền hệ thống', async () => {
    const user = await createUser('site-user');
    const teacher = await createUser('site-teacher', 'teacher');
    const admin = await createUser('site-admin', 'admin');

    expect(await can(user.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
      reason: 'no_grant',
    });
    expect(await can(teacher.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: true,
    });
    expect(await can(admin.id, 'platform:moderate', 'system', 'giaokhoa')).toMatchObject({
      allowed: true,
    });
    expect(await can(admin.id, 'class:manage_any', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
    });
    expect(await db.select().from(authzRoleAssignments)).toHaveLength(0);
    expect(await db.select().from(authzCapabilities)).toHaveLength(21);
    expect(await db.select().from(authzRoles)).toHaveLength(6);
  });

  it('thu hồi quyền quản lý lớp sau khi hạ vai trò và khôi phục khi gia hạn', async () => {
    const teacher = await createUser('renewable-teacher', 'teacher');
    const classroom = await createClass(teacher.id, `renewable-${randomUUID()}`);
    const classesRepository = new PostgresClassesRepository(db);

    expect(await can(teacher.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: true,
    });
    await db.update(users).set({ role: 'user' }).where(eq(users.id, teacher.id));

    for (const capability of [
      'class:view',
      'class:update',
      'class:enrolment_manage',
      'assignment:publish',
      'result:view_class',
    ]) {
      expect(await can(teacher.id, capability, 'class', classroom.resourceKey)).toMatchObject({
        allowed: false,
      });
    }
    expect(
      await classesRepository.update(classroom.resourceKey, teacher.id, { name: 'Not allowed' }),
    ).toBeUndefined();
    expect(await classesRepository.findById(classroom.resourceKey)).toBeDefined();
    const assignmentRows = await db
      .select({ id: authzRoleAssignments.id })
      .from(authzRoleAssignments)
      .where(
        and(
          eq(authzRoleAssignments.contextId, classroom.id),
          isNull(authzRoleAssignments.revokedAt),
        ),
      );
    expect(assignmentRows).toHaveLength(1);

    await db.update(users).set({ role: 'teacher' }).where(eq(users.id, teacher.id));
    expect(await can(teacher.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: true,
    });
    expect(
      await classesRepository.update(classroom.resourceKey, teacher.id, { name: 'Renewed class' }),
    ).toMatchObject({ name: 'Renewed class' });
  });

  it('tạo phạm vi lớp và chủ sở hữu nguyên tử, tách các phạm vi cùng cấp và thu hồi ngay', async () => {
    const owner = await createUser('owner', 'teacher');
    const otherTeacher = await createUser('other-owner', 'teacher');
    const student = await createUser('student');
    const classOne = await createClass(owner.id, `C1-${randomUUID()}`);
    const classTwo = await createClass(otherTeacher.id, `C2-${randomUUID()}`);

    expect(await can(owner.id, 'class:update', 'class', classOne.resourceKey)).toMatchObject({
      allowed: true,
    });
    expect(await can(otherTeacher.id, 'class:update', 'class', classOne.resourceKey)).toMatchObject(
      {
        allowed: false,
      },
    );
    expect(await can(owner.id, 'assignment:publish', 'class', classTwo.resourceKey)).toMatchObject({
      allowed: false,
    });

    const assignment = {
      contextId: classOne.id,
      userId: student.id,
      roleKey: 'class:student',
      source: 'enrolment',
      grantedByUserId: owner.id,
    };
    await db
      .insert(classEnrolments)
      .values({ classId: classOne.resourceKey, userId: student.id, status: 'active' });
    expect(await repository.assignRole(assignment)).toBe(true);
    expect(await repository.assignRole(assignment)).toBe(false);
    expect(
      await can(student.id, 'assignment:attempt', 'class', classOne.resourceKey),
    ).toMatchObject({
      allowed: true,
    });
    expect(
      await can(student.id, 'assignment:attempt', 'class', classTwo.resourceKey),
    ).toMatchObject({
      allowed: false,
    });

    expect(await repository.revokeRole(classOne.id, student.id, 'class:student')).toBe(true);
    expect(await repository.revokeRole(classOne.id, student.id, 'class:student')).toBe(false);
    expect(
      await can(student.id, 'assignment:attempt', 'class', classOne.resourceKey),
    ).toMatchObject({
      allowed: false,
    });
    expect(await repository.assignRole(assignment)).toBe(true);

    const [activeCount] = await db
      .select({ id: authzRoleAssignments.id })
      .from(authzRoleAssignments)
      .where(
        and(eq(authzRoleAssignments.userId, student.id), isNull(authzRoleAssignments.revokedAt)),
      );
    expect(activeCount).toBeDefined();
  });

  it('hoàn tác tạo phạm vi khi khóa ngoại gán vai trò thất bại', async () => {
    const key = `rollback-${randomUUID()}`;
    await expect(
      repository.createContextWithRole({
        context: { kind: 'class', resourceKey: key, parentId: systemId },
        userId: randomUUID(),
        roleKey: 'class:owner',
        source: 'class_create',
      }),
    ).rejects.toThrow();
    expect(await repository.findContext({ kind: 'class', resourceKey: key })).toBeUndefined();
  });

  it('từ chối vai trò ở sai phạm vi và mặc định cấm khi vai trò tài khoản thiếu hoặc không rõ', async () => {
    const teacher = await createUser('nullable', 'teacher');
    const aClass = await createClass(teacher.id, `role-${randomUUID()}`);
    await expect(
      repository.assignRole({
        contextId: aClass.id,
        userId: teacher.id,
        roleKey: 'system:admin',
        source: 'invalid',
      }),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'authorization_role_invalid' });

    await db.update(users).set({ role: null }).where(eq(users.id, teacher.id));
    expect(await can(teacher.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
    });
    await db.update(users).set({ role: 'unsupported_role' }).where(eq(users.id, teacher.id));
    expect(await can(teacher.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
    });
  });

  it('ưu tiên quyền cấm PREVENT và PROHIBIT hơn ALLOW của chủ lớp', async () => {
    const owner = await createUser('multi-role', 'teacher');
    const aClass = await createClass(owner.id, `effects-${randomUUID()}`);
    await db
      .insert(classEnrolments)
      .values({ classId: aClass.resourceKey, userId: owner.id, status: 'active' });
    await repository.assignRole({
      contextId: aClass.id,
      userId: owner.id,
      roleKey: 'class:student',
      source: 'enrolment',
    });
    const [studentRole] = await db
      .select()
      .from(authzRoles)
      .where(eq(authzRoles.key, 'class:student'));
    const [capability] = await db
      .select()
      .from(authzCapabilities)
      .where(eq(authzCapabilities.key, 'class:update'));
    await db.insert(authzRolePermissions).values({
      roleId: studentRole.id,
      capabilityId: capability.id,
      effect: 'PREVENT',
    });
    expect(await can(owner.id, 'class:update', 'class', aClass.resourceKey)).toMatchObject({
      allowed: false,
      reason: 'prevented',
    });
    await db
      .update(authzRolePermissions)
      .set({ effect: 'PROHIBIT' })
      .where(
        and(
          eq(authzRolePermissions.roleId, studentRole.id),
          eq(authzRolePermissions.capabilityId, capability.id),
        ),
      );
    expect(await can(owner.id, 'class:update', 'class', aClass.resourceKey)).toMatchObject({
      allowed: false,
      reason: 'prohibited',
    });
  });
});
