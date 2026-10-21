import { grantSystemRole, revokeSystemRole } from './roles.js';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAuthorizationRepository } from '../src/repositories/authorization.js';
import { migrationsFolder } from '../src/migrations.js';
import { users } from '../src/schema/auth.generated.js';
import { classEnrolments, classes } from '../src/schema/classes.js';
import * as schema from '../src/schema/index.js';
import type { Database } from '../src/types.js';

const databaseName = `gk_auth_repository_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
let db: Database;
let repository: PostgresAuthorizationRepository;
let systemId: string;

function url(name: string) {
  const source = process.env.DATABASE_URL;
  if (!source || !new URL(source).pathname.includes('test')) {
    throw new Error('Cần cơ sở dữ liệu PostgreSQL chỉ dành cho kiểm thử');
  }
  const parsed = new URL(source);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function adminQuery(query: string) {
  const client = new Client({ connectionString: url('postgres') });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

async function actor(role: 'user' | 'teacher' = 'user') {
  const [row] = await db
    .insert(users)
    .values({
      name: role,
      email: `${randomUUID()}@example.com`,
    })
    .returning();
  if (role !== 'user') await grantSystemRole(db, row.id, role);
  return row;
}

beforeAll(async () => {
  await adminQuery(`CREATE DATABASE "${databaseName}"`);
  pool = new Pool({ connectionString: url(databaseName) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  repository = new PostgresAuthorizationRepository(db);
  const system = await repository.findContext({ kind: 'system', resourceKey: 'giaokhoa' });
  if (!system) throw new Error('Thiếu phạm vi phân quyền hệ thống sau khi di trú');
  systemId = system.id;
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await adminQuery(`DROP DATABASE IF EXISTS "${databaseName}"`);
}, 30_000);

describe('Kho phân quyền PostgreSQL (PostgresAuthorizationRepository)', () => {
  it('tạo phạm vi lớp và vai trò chủ trong cùng giao dịch, rồi truy vấn bằng cả hai loại khóa', async () => {
    const teacher = await actor('teacher');
    const key = `class-${randomUUID()}`;
    const context = await repository.createContextWithRole({
      context: { kind: 'class', resourceKey: key, parentId: systemId },
      userId: teacher.id,
      roleKey: 'class:owner',
      source: 'class_creation',
      grantedByUserId: teacher.id,
    });
    expect(context).toMatchObject({ kind: 'class', resourceKey: key, parentId: systemId });
    expect(await repository.findContext({ kind: 'class', resourceKey: key })).toEqual(context);
    expect(await repository.findContextById(context.id)).toEqual(context);
    expect(await repository.findContextById(randomUUID())).toBeUndefined();
    expect(
      await repository.findPermissions(teacher.id, 'class:update', [context.id]),
    ).toContainEqual({ contextId: context.id, effect: 'ALLOW' });
  });

  it('cấp vai trò học sinh không trùng, thu hồi rồi cấp lại trong lớp đang hoạt động', async () => {
    const teacher = await actor('teacher');
    const student = await actor();
    const context = await repository.createContextWithRole({
      context: { kind: 'class', resourceKey: randomUUID(), parentId: systemId },
      userId: teacher.id,
      roleKey: 'class:owner',
      source: 'class_creation',
    });
    const [classroom] = await db
      .insert(classes)
      .values({
        name: 'Lớp thử nghiệm',
        joinMode: 'AUTO',
        createdByUserId: teacher.id,
        authzContextId: context.id,
      })
      .returning();
    await db.insert(classEnrolments).values({
      classId: classroom.id,
      userId: student.id,
      status: 'active',
    });
    const input = {
      contextId: context.id,
      userId: student.id,
      roleKey: 'class:student',
      source: 'class_enrolment',
    };
    expect(await repository.assignRole(input)).toBe(true);
    expect(await repository.assignRole(input)).toBe(false);
    expect(
      await repository.findPermissions(student.id, 'assignment:attempt', [context.id]),
    ).toContainEqual({ contextId: context.id, effect: 'ALLOW' });
    expect(await repository.revokeRole(context.id, student.id, 'class:student')).toBe(true);
    expect(await repository.revokeRole(context.id, student.id, 'class:student')).toBe(false);
    expect(
      await repository.findPermissions(student.id, 'assignment:attempt', [context.id]),
    ).toEqual([]);
    expect(await repository.assignRole(input)).toBe(true);
    await db
      .update(classEnrolments)
      .set({ status: 'suspended' })
      .where(eq(classEnrolments.userId, student.id));
    expect(
      await repository.findPermissions(student.id, 'assignment:attempt', [context.id]),
    ).toEqual([]);
  });

  it('vai trò hệ thống được gán và thu hồi trong context hệ thống, tài khoản khóa mất quyền', async () => {
    const teacher = await actor('teacher');
    const system = await repository.findContextById(systemId);
    expect(system?.kind).toBe('system');
    expect(
      await repository.assignRole({
        contextId: systemId,
        userId: teacher.id,
        roleKey: 'system:teacher',
        source: 'test',
      }),
    ).toBe(false);
    expect(await repository.findPermissions(teacher.id, 'class:create', [systemId])).toContainEqual(
      { contextId: systemId, effect: 'ALLOW' },
    );
    expect(await revokeSystemRole(db, teacher.id, 'teacher')).toBe(true);
    expect(await repository.findPermissions(teacher.id, 'class:create', [systemId])).toEqual([]);
    expect(await grantSystemRole(db, teacher.id, 'teacher')).toBe(true);
    await db.update(users).set({ banned: true }).where(eq(users.id, teacher.id));
    expect(await repository.findPermissions(teacher.id, 'class:create', [systemId])).toEqual([]);
    expect(await repository.findPermissions(teacher.id, 'class:create', [])).toEqual([]);
  });

  it('không để lại phạm vi phân quyền khi cấp vai trò ban đầu thất bại', async () => {
    const key = `rolled-back-${randomUUID()}`;
    await expect(
      repository.createContextWithRole({
        context: { kind: 'class', resourceKey: key, parentId: systemId },
        userId: randomUUID(),
        roleKey: 'class:owner',
        source: 'test',
      }),
    ).rejects.toThrow();
    expect(await repository.findContext({ kind: 'class', resourceKey: key })).toBeUndefined();
  });
});
