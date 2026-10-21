import { grantSystemRole, revokeSystemRole, revokeRole, grantRole } from '../../helpers/roles.js';
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
  authzContexts,
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
    })
    .returning();
  if (role !== 'user') await grantSystemRole(db, created.id, role);
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

function can(
  actorId: string,
  capability: string,
  kind: 'system' | 'class' | 'assignment',
  resourceKey: string,
) {
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
  it('khởi tạo quyền mặc định của tài khoản và cấp vai trò hệ thống qua context', async () => {
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
    expect(await db.select().from(authzRoleAssignments)).toHaveLength(2);
    expect(await db.select().from(authzCapabilities)).toHaveLength(25);
    expect(await db.select().from(authzRoles)).toHaveLength(6);
  });

  it('xét vai trò học sinh được gán trực tiếp tại hoạt động theo tư cách ghi danh ở lớp cha', async () => {
    const owner = await createUser('activity-owner', 'teacher');
    const student = await createUser('activity-student');
    const classroom = await createClass(owner.id, `activity-${randomUUID()}`);
    const [first] = await db
      .insert(authzContexts)
      .values({
        kind: 'assignment',
        resourceKey: randomUUID(),
        parentId: classroom.id,
      })
      .returning();
    const [sibling] = await db
      .insert(authzContexts)
      .values({
        kind: 'assignment',
        resourceKey: randomUUID(),
        parentId: classroom.id,
      })
      .returning();
    await db.insert(classEnrolments).values({
      classId: classroom.resourceKey,
      userId: student.id,
      status: 'active',
    });
    expect(
      await repository.assignRole({
        contextId: first.id,
        userId: student.id,
        roleKey: 'class:student',
        source: 'test',
      }),
    ).toBe(true);
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: true });
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', sibling.resourceKey),
    ).toMatchObject({ allowed: false });
    expect(await can(student.id, 'class:view', 'class', classroom.resourceKey)).toMatchObject({
      allowed: false,
    });
    await db
      .update(classEnrolments)
      .set({ status: 'suspended' })
      .where(
        and(
          eq(classEnrolments.classId, classroom.resourceKey),
          eq(classEnrolments.userId, student.id),
        ),
      );
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: false });
    await db
      .update(classEnrolments)
      .set({ status: 'active' })
      .where(
        and(
          eq(classEnrolments.classId, classroom.resourceKey),
          eq(classEnrolments.userId, student.id),
        ),
      );
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: true });
    await repository.revokeRole(first.id, student.id, 'class:student');
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: false });
  });

  it('vai trò hệ thống và lớp độc lập, thu hồi vai trò chủ lớp có hiệu lực ngay', async () => {
    const teacher = await createUser('renewable-teacher', 'teacher');
    const classroom = await createClass(teacher.id, `renewable-${randomUUID()}`);
    const classesRepository = new PostgresClassesRepository(db);

    expect(await can(teacher.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: true,
    });
    await revokeSystemRole(db, teacher.id, 'teacher');
    expect(await can(teacher.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
    });
    // Gỡ vai trò hệ thống không được âm thầm thu hồi quyền tại context lớp.
    expect(await can(teacher.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: true,
    });
    await revokeRole(db, teacher.id, 'class:owner', 'class', classroom.resourceKey);
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
    await grantRole(db, teacher.id, 'class:owner', 'class', classroom.resourceKey);
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

  it('không cấp vai trò sai phạm vi, thu hồi quyền hệ thống ngay sau thao tác', async () => {
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
    await revokeSystemRole(db, teacher.id, 'teacher');
    expect(await can(teacher.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
    });
    await expect(
      repository.assignRole({
        contextId: systemId,
        userId: teacher.id,
        roleKey: 'system:missing',
        source: 'invalid',
      }),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'authorization_role_invalid' });
    expect(await can(teacher.id, 'class:create', 'system', 'giaokhoa')).toMatchObject({
      allowed: false,
    });
  });

  it('ALLOW của vai trò chủ lớp thắng PREVENT khác vai trò, PROHIBIT vẫn tuyệt đối', async () => {
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
      allowed: true,
      reason: 'granted',
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

  it('ma trận Moodle cho phép phân quyền giáo viên trong lớp mà không ràng buộc người tạo', async () => {
    const owner = await createUser('grant-owner', 'teacher');
    const colleague = await createUser('grant-colleague');
    const classroom = await createClass(owner.id, `grant-${randomUUID()}`);
    const classesRepository = new PostgresClassesRepository(db);
    await expect(
      service.changeRole(colleague.id, classroom.id, colleague.id, 'class:student', true),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(
      await service.changeRole(owner.id, classroom.id, colleague.id, 'class:teacher', true),
    ).toBe(true);
    expect(await can(colleague.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: true,
    });
    await expect(
      classesRepository.update(classroom.resourceKey, colleague.id, { name: 'Đồng giáo viên' }),
    ).resolves.toMatchObject({ name: 'Đồng giáo viên' });
    await expect(
      service.changeRole(owner.id, classroom.id, colleague.id, 'system:admin', true),
    ).rejects.toMatchObject({ kind: 'invalid' });
    await expect(
      service.changeRole(owner.id, classroom.id, colleague.id, 'class:owner', true),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(
      await service.changeRole(owner.id, classroom.id, colleague.id, 'class:teacher', false),
    ).toBe(true);
    expect(await can(colleague.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: false,
    });
  });

  it('quản trị viên định nghĩa vai trò, quyền, loại ngữ cảnh và ma trận gán/ghi đè bằng API nghiệp vụ', async () => {
    const admin = await createUser('definition-admin', 'admin');
    const regular = await createUser('definition-user');
    const classroomOwner = await createUser('definition-owner', 'teacher');
    const classroom = await createClass(classroomOwner.id, `definition-${randomUUID()}`);
    const roleKey = `custom:mentor-${randomUUID()}`;
    await expect(service.createRole(regular.id, roleKey, 'class', ['class'])).rejects.toMatchObject(
      { kind: 'forbidden' },
    );
    expect(await service.createRole(admin.id, roleKey, 'class', ['class'])).toBe(true);
    expect(await service.createRole(admin.id, roleKey, 'class', ['class'])).toBe(false);
    expect(await service.setRolePermission(admin.id, roleKey, 'class:update', 'ALLOW')).toBe(true);
    await expect(
      service.setRoleMatrix(regular.id, 'system:admin', roleKey, 'assign', true),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await service.setRoleMatrix(admin.id, 'system:admin', roleKey, 'assign', true)).toBe(
      true,
    );
    expect(await service.setRoleMatrix(admin.id, 'system:admin', roleKey, 'override', true)).toBe(
      true,
    );
    await expect(
      service.changeRole(classroomOwner.id, classroom.id, regular.id, roleKey, true),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await service.changeRole(admin.id, classroom.id, regular.id, roleKey, true)).toBe(true);
    expect(await can(regular.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: true,
    });
    expect(await service.setRolePermission(admin.id, roleKey, 'class:update', 'INHERIT')).toBe(
      true,
    );
    expect(await can(regular.id, 'class:update', 'class', classroom.resourceKey)).toMatchObject({
      allowed: false,
    });
    expect(await service.setRoleContexts(admin.id, roleKey, ['assignment'])).toBe(true);
    await expect(
      service.changeRole(admin.id, classroom.id, classroomOwner.id, roleKey, true),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(await service.setRoleContexts(admin.id, roleKey, ['class', 'assignment'])).toBe(true);
    expect(await service.setRoleMatrix(admin.id, 'system:admin', roleKey, 'assign', false)).toBe(
      true,
    );
    await expect(
      service.changeRole(admin.id, classroom.id, classroomOwner.id, roleKey, true),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('ghi đè vai trò cho riêng một hoạt động và INHERIT khôi phục quyền gốc', async () => {
    const owner = await createUser('override-owner', 'teacher');
    const student = await createUser('override-student');
    const classroom = await createClass(owner.id, `override-${randomUUID()}`);
    await db
      .insert(classEnrolments)
      .values({ classId: classroom.resourceKey, userId: student.id, status: 'active' });
    await repository.assignRole({
      contextId: classroom.id,
      userId: student.id,
      roleKey: 'class:student',
      source: 'enrolment',
    });
    const [first] = await db
      .insert(authzContexts)
      .values({ kind: 'assignment', resourceKey: randomUUID(), parentId: classroom.id })
      .returning();
    const [second] = await db
      .insert(authzContexts)
      .values({ kind: 'assignment', resourceKey: randomUUID(), parentId: classroom.id })
      .returning();
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: true });
    await expect(
      service.overrideRole(student.id, first.id, 'class:student', 'assignment:attempt', 'PREVENT'),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(
      await service.overrideRole(
        owner.id,
        first.id,
        'class:student',
        'assignment:attempt',
        'PREVENT',
      ),
    ).toBe(true);
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: false, reason: 'prevented' });
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', second.resourceKey),
    ).toMatchObject({ allowed: true });
    expect(
      await service.overrideRole(
        owner.id,
        first.id,
        'class:student',
        'assignment:attempt',
        'INHERIT',
      ),
    ).toBe(true);
    expect(
      await can(student.id, 'assignment:attempt', 'assignment', first.resourceKey),
    ).toMatchObject({ allowed: true });
    await expect(
      service.overrideRole(owner.id, first.id, 'system:admin', 'assignment:attempt', 'ALLOW'),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
