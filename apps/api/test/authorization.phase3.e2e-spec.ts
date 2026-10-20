import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClassesService } from '@giaokhoa/application/classes/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import * as schema from '@giaokhoa/database/schema';
import { users } from '@giaokhoa/database/schema/auth.generated';
import {
  authzContexts,
  authzRoleAssignments,
  authzRoles,
} from '@giaokhoa/database/schema/authorization';
import { classes, classEnrolments, classJoinCodes } from '@giaokhoa/database/schema/classes';
import type { Database } from '@giaokhoa/database/types';

const name = `giaokhoa_phase3_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
let db: Database;
let service: ClassesService;
let repository: PostgresClassesRepository;
let authorization: AuthorizationService;

function url(database: string) {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required for isolated Phase 3 tests');
  const parsed = new URL(process.env.DATABASE_URL);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function adminConnection<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: url('postgres') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function actor(role: 'teacher' | 'user' | 'admin' = 'user') {
  const [row] = await db
    .insert(users)
    .values({
      name: role,
      email: `${randomUUID()}@example.com`,
      role,
    })
    .returning();
  return row;
}

async function allowed(userId: string, capability: string, classId: string) {
  return (
    await authorization.authorize({
      actorId: userId,
      capability,
      context: { kind: 'class', resourceKey: classId },
    })
  ).allowed;
}

beforeAll(async () => {
  await adminConnection((client) => client.query(`CREATE DATABASE "${name}"`));
  pool = new Pool({ connectionString: url(name) });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  repository = new PostgresClassesRepository(db);
  authorization = new AuthorizationService(new PostgresAuthorizationRepository(db));
  service = new ClassesService(repository, authorization);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await adminConnection((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}, 30_000);

describe('Phase 3 class lifecycle and enrolment authorization', () => {
  it('creates class, context and owner atomically; restricts other teachers and students', async () => {
    const owner = await actor('teacher');
    const other = await actor('teacher');
    const student = await actor();
    await expect(
      service.createClass(student.id, { name: 'Blocked', joinMode: 'AUTO' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    const classroom = await service.createClass(owner.id, { name: 'Math', joinMode: 'AUTO' });
    expect(classroom.createdByUserId).toBe(owner.id);
    expect(await allowed(owner.id, 'class:update', classroom.id)).toBe(true);
    expect(await allowed(owner.id, 'class:grant_teacher', classroom.id)).toBe(false);
    expect(await allowed(other.id, 'class:update', classroom.id)).toBe(false);
    await expect(
      service.updateClass(other.id, classroom.id, { name: 'Stolen' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    const [context] = await db
      .select()
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, 'class'), eq(authzContexts.resourceKey, classroom.id)));
    const [ownerRole] = await db.select().from(authzRoles).where(eq(authzRoles.key, 'class:owner'));
    expect(context.id).toBeTruthy();
    const grants = await db
      .select()
      .from(authzRoleAssignments)
      .where(
        and(
          eq(authzRoleAssignments.contextId, context.id),
          eq(authzRoleAssignments.roleId, ownerRole.id),
          eq(authzRoleAssignments.userId, owner.id),
          isNull(authzRoleAssignments.revokedAt),
        ),
      );
    expect(grants).toHaveLength(1);
    const updated = await service.updateClass(owner.id, classroom.id, { name: 'Math 2' });
    expect(updated.name).toBe('Math 2');

    await db.execute(sql`CREATE FUNCTION phase3_reject_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source = 'class_creation' THEN RAISE EXCEPTION 'forced assignment failure'; END IF;
      RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER phase3_reject_owner_trigger
      BEFORE INSERT ON authz_role_assignments FOR EACH ROW EXECUTE FUNCTION phase3_reject_owner()`);
    try {
      await expect(
        repository.create({ name: 'Orphan', joinMode: 'AUTO' }, owner.id),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER phase3_reject_owner_trigger ON authz_role_assignments`);
      await db.execute(sql`DROP FUNCTION phase3_reject_owner()`);
    }
    expect(await db.select().from(classes).where(eq(classes.name, 'Orphan'))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(authzContexts)
        .where(and(eq(authzContexts.kind, 'class'), eq(authzContexts.resourceKey, classroom.id))),
    ).toHaveLength(1);
  });

  it('AUTO join creates one active enrolment and role, including teacher-as-student', async () => {
    const owner = await actor('teacher');
    const student = await actor('teacher');
    const classroom = await service.createClass(owner.id, { name: 'Physics', joinMode: 'AUTO' });
    const { code } = await service.createJoinCode(owner.id, classroom.id, {
      expiresInHours: 24,
      maxUses: 1,
    });
    const [first, second, third] = await Promise.all([
      service.joinClass(student.id, code),
      service.joinClass(student.id, code),
      service.joinClass(student.id, code),
    ]);
    expect(first).toEqual({ classId: classroom.id, status: 'active' });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(true);
    expect(await allowed(student.id, 'class:update', classroom.id)).toBe(false);
    const enrolled = await db
      .select()
      .from(classEnrolments)
      .where(
        and(eq(classEnrolments.classId, classroom.id), eq(classEnrolments.userId, student.id)),
      );
    expect(enrolled).toHaveLength(1);
    const [joinCode] = await db
      .select()
      .from(classJoinCodes)
      .where(eq(classJoinCodes.codeHash, createHash('sha256').update(code).digest('hex')));
    expect(joinCode.usedCount).toBe(1);
    const stranger = await actor();
    await expect(service.joinClass(stranger.id, code)).rejects.toMatchObject({
      code: 'class_join_code_invalid',
    });
  });

  it('APPROVAL holds access pending, approval grants it, suspension revokes it', async () => {
    const owner = await actor('teacher');
    const other = await actor('teacher');
    const student = await actor();
    const classroom = await service.createClass(owner.id, {
      name: 'Chemistry',
      joinMode: 'APPROVAL',
    });
    const { code } = await service.createJoinCode(owner.id, classroom.id, { expiresInHours: 24 });
    expect((await service.joinClass(student.id, code)).status).toBe('pending');
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(false);
    await expect(service.approveMember(other.id, classroom.id, student.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect((await service.approveMember(owner.id, classroom.id, student.id)).status).toBe('active');
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(true);
    expect((await service.suspendMember(owner.id, classroom.id, student.id)).status).toBe(
      'suspended',
    );
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(false);
    await expect(service.joinClass(student.id, code)).rejects.toMatchObject({
      code: 'class_membership_suspended',
    });
  });

  it('denies stale student role, allows leave and rejoin without duplicate active assignment', async () => {
    const owner = await actor('teacher');
    const student = await actor();
    const classroom = await service.createClass(owner.id, { name: 'Biology', joinMode: 'AUTO' });
    const { code } = await service.createJoinCode(owner.id, classroom.id, { expiresInHours: 24 });
    await service.joinClass(student.id, code);
    await service.leaveClass(student.id, classroom.id);
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(false);
    const [oldGrant] = await db
      .select()
      .from(authzRoleAssignments)
      .where(eq(authzRoleAssignments.userId, student.id));
    await db
      .update(authzRoleAssignments)
      .set({ revokedAt: null })
      .where(eq(authzRoleAssignments.id, oldGrant.id));
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(false);
    await service.joinClass(student.id, code);
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(true);
    const context = await db
      .select()
      .from(authzContexts)
      .where(eq(authzContexts.resourceKey, classroom.id));
    expect(context).toHaveLength(1);
    const role = await db
      .select()
      .from(authzRoleAssignments)
      .where(
        and(
          eq(authzRoleAssignments.userId, student.id),
          eq(authzRoleAssignments.contextId, context[0].id),
          isNull(authzRoleAssignments.revokedAt),
        ),
      );
    expect(role).toHaveLength(1);
  });

  it('rejects invalid/expired/revoked codes, archived class, and downgraded class creation', async () => {
    const owner = await actor('teacher');
    const student = await actor();
    const classroom = await service.createClass(owner.id, { name: 'History', joinMode: 'AUTO' });
    await expect(service.joinClass(student.id, 'bogus-code')).rejects.toMatchObject({
      code: 'class_join_code_invalid',
    });
    const { id: codeId, code } = await service.createJoinCode(owner.id, classroom.id, {
      expiresInHours: 24,
    });
    await db
      .update(classJoinCodes)
      .set({ expiresAt: new Date(0) })
      .where(eq(classJoinCodes.id, codeId));
    await expect(service.joinClass(student.id, code)).rejects.toMatchObject({ kind: 'not_found' });
    await db
      .update(classJoinCodes)
      .set({ expiresAt: new Date(Date.now() + 86_400_000) })
      .where(eq(classJoinCodes.id, codeId));
    await service.revokeJoinCode(owner.id, classroom.id, codeId);
    await expect(service.joinClass(student.id, code)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(service.revokeJoinCode(owner.id, classroom.id, codeId)).rejects.toMatchObject({
      kind: 'not_found',
    });
    await service.updateClass(owner.id, classroom.id, { status: 'archived' });
    await expect(
      service.createJoinCode(owner.id, classroom.id, { expiresInHours: 24 }),
    ).rejects.toMatchObject({ code: 'class_not_joinable' });
    await db.update(users).set({ role: 'user' }).where(eq(users.id, owner.id));
    await expect(
      service.createClass(owner.id, { name: 'Second', joinMode: 'AUTO' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('honors immediate owner revocation and banned account', async () => {
    const owner = await actor('teacher');
    const student = await actor();
    const classroom = await service.createClass(owner.id, { name: 'Art', joinMode: 'AUTO' });
    const { code } = await service.createJoinCode(owner.id, classroom.id, { expiresInHours: 24 });
    await service.joinClass(student.id, code);
    await db.update(users).set({ banned: true }).where(eq(users.id, student.id));
    expect(await allowed(student.id, 'class:view', classroom.id)).toBe(false);
    const [context] = await db
      .select()
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, 'class'), eq(authzContexts.resourceKey, classroom.id)));
    await db
      .update(authzRoleAssignments)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authzRoleAssignments.contextId, context.id),
          eq(authzRoleAssignments.userId, owner.id),
        ),
      );
    await expect(
      service.updateClass(owner.id, classroom.id, { name: 'Hidden' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
