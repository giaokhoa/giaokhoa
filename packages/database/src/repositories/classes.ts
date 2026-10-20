import { ClientError } from '@giaokhoa/application/common/client-error';
import type { ClassesRepository } from '@giaokhoa/application/classes/repository';
import {
  classEnrolmentSchema,
  classSchema,
  type ClassCreate,
  type ClassPatch,
} from '@giaokhoa/shared/classes';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import { authzContexts, authzRoleAssignments, authzRoles } from '../schema/authorization.js';
import { classes, classEnrolments, classJoinCodes } from '../schema/classes.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function codeInvalid(): ClientError {
  return new ClientError(
    'not_found',
    'class_join_code_invalid',
    'Mã tham gia không hợp lệ hoặc đã hết hạn',
  );
}

function membership(row: typeof classEnrolments.$inferSelect) {
  return classEnrolmentSchema.parse({
    userId: row.userId,
    status: row.status,
    joinedAt: row.joinedAt,
    updatedAt: row.updatedAt,
  });
}

function publicClass(row: typeof classes.$inferSelect) {
  return classSchema.parse({
    id: row.id,
    name: row.name,
    createdByUserId: row.createdByUserId,
    status: row.status,
    joinMode: row.joinMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

async function activeAccountRole(tx: Transaction, actorId: string) {
  const [actor] = await tx
    .select({ role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, actorId))
    .for('share')
    .limit(1);
  if (!actor || actor.banned) return undefined;
  if (actor.role === 'user' || actor.role === 'teacher' || actor.role === 'admin')
    return actor.role;
  return undefined;
}

async function classOwner(tx: Transaction, row: typeof classes.$inferSelect, actorId: string) {
  if (
    row.createdByUserId !== actorId ||
    !row.authzContextId ||
    !(await activeAccountRole(tx, actorId))
  )
    return false;
  const [owner] = await tx
    .select({ id: authzRoleAssignments.id })
    .from(authzRoleAssignments)
    .innerJoin(authzRoles, eq(authzRoleAssignments.roleId, authzRoles.id))
    .where(
      and(
        eq(authzRoleAssignments.contextId, row.authzContextId),
        eq(authzRoleAssignments.userId, actorId),
        isNull(authzRoleAssignments.revokedAt),
        eq(authzRoles.key, 'class:owner'),
      ),
    )
    .for('share')
    .limit(1);
  return !!owner;
}

async function studentRole(tx: Transaction, row: typeof classes.$inferSelect) {
  if (!row.authzContextId)
    throw new ClientError('conflict', 'class_context_missing', 'Context lớp chưa sẵn sàng');
  const [role] = await tx
    .select({ id: authzRoles.id })
    .from(authzRoles)
    .where(eq(authzRoles.key, 'class:student'))
    .limit(1);
  if (!role)
    throw new ClientError('conflict', 'class_role_missing', 'Vai trò học sinh chưa sẵn sàng');
  return { contextId: row.authzContextId, roleId: role.id };
}

async function grantStudent(tx: Transaction, row: typeof classes.$inferSelect, userId: string) {
  const role = await studentRole(tx, row);
  await tx
    .insert(authzRoleAssignments)
    .values({
      ...role,
      userId,
      source: 'class_enrolment',
    })
    .onConflictDoNothing();
}

async function revokeStudent(tx: Transaction, row: typeof classes.$inferSelect, userId: string) {
  const role = await studentRole(tx, row);
  await tx
    .update(authzRoleAssignments)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authzRoleAssignments.contextId, role.contextId),
        eq(authzRoleAssignments.roleId, role.roleId),
        eq(authzRoleAssignments.userId, userId),
        isNull(authzRoleAssignments.revokedAt),
      ),
    );
}

export class PostgresClassesRepository implements ClassesRepository {
  constructor(private readonly db: Database) {}

  async create(input: ClassCreate, actorId: string) {
    return this.db.transaction(async (tx) => {
      const role = await activeAccountRole(tx, actorId);
      if (role !== 'teacher' && role !== 'admin')
        throw new ClientError('forbidden', 'authorization_denied', 'Bạn không có quyền tạo lớp');
      const [parent] = await tx
        .select({ id: authzContexts.id })
        .from(authzContexts)
        .where(and(eq(authzContexts.kind, 'system'), eq(authzContexts.resourceKey, 'giaokhoa')))
        .limit(1);
      const [ownerRole] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, 'class:owner'))
        .limit(1);
      if (!parent || !ownerRole)
        throw new ClientError(
          'conflict',
          'authorization_not_initialized',
          'Phân quyền chưa khởi tạo',
        );
      const [created] = await tx
        .insert(classes)
        .values({
          name: input.name,
          joinMode: input.joinMode,
          createdByUserId: actorId,
        })
        .returning();
      const [context] = await tx
        .insert(authzContexts)
        .values({
          kind: 'class',
          resourceKey: created.id,
          parentId: parent.id,
        })
        .returning({ id: authzContexts.id });
      await tx
        .update(classes)
        .set({ authzContextId: context.id })
        .where(eq(classes.id, created.id));
      await tx.insert(authzRoleAssignments).values({
        contextId: context.id,
        roleId: ownerRole.id,
        userId: actorId,
        source: 'class_creation',
        grantedByUserId: actorId,
      });
      return publicClass(created);
    });
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(classes).where(eq(classes.id, id)).limit(1);
    return row ? publicClass(row) : undefined;
  }

  async update(id: string, actorId: string, patch: ClassPatch) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, id))
        .for('update')
        .limit(1);
      if (!row || !(await classOwner(tx, row, actorId))) return undefined;
      const [updated] = await tx
        .update(classes)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(classes.id, id))
        .returning();
      return publicClass(updated);
    });
  }

  async createJoinCode(
    classId: string,
    actorId: string,
    codeHash: string,
    expiresAt: Date,
    maxUses?: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('update')
        .limit(1);
      if (!row || row.status !== 'active' || !(await classOwner(tx, row, actorId)))
        return undefined;
      const [created] = await tx
        .insert(classJoinCodes)
        .values({
          classId,
          codeHash,
          expiresAt,
          maxUses,
          createdByUserId: actorId,
        })
        .returning({ id: classJoinCodes.id });
      return created.id;
    });
  }

  async revokeJoinCode(classId: string, codeId: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('update')
        .limit(1);
      if (!classroom || !(await classOwner(tx, classroom, actorId))) return false;
      const revoked = await tx
        .update(classJoinCodes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(classJoinCodes.id, codeId),
            eq(classJoinCodes.classId, classId),
            isNull(classJoinCodes.revokedAt),
          ),
        )
        .returning({ id: classJoinCodes.id });
      return revoked.length > 0;
    });
  }

  /**
   * Khóa lớp rồi mã và enrolment để kiểm hạn/số lượt dùng, cập nhật thành viên
   * và cấp class:student trong một transaction; pending chưa được cấp role.
   */
  async join(codeHash: string, actorId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      if (!(await activeAccountRole(tx, actorId)))
        throw new ClientError(
          'forbidden',
          'authorization_denied',
          'Bạn không có quyền tham gia lớp',
        );
      const [codeRef] = await tx
        .select({ classId: classJoinCodes.classId })
        .from(classJoinCodes)
        .where(eq(classJoinCodes.codeHash, codeHash))
        .limit(1);
      if (!codeRef) throw codeInvalid();
      // Khóa lớp trước mã để cùng thứ tự với thao tác thu hồi, tránh deadlock.
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, codeRef.classId))
        .for('update')
        .limit(1);
      const [code] = await tx
        .select()
        .from(classJoinCodes)
        .where(eq(classJoinCodes.codeHash, codeHash))
        .for('update')
        .limit(1);
      if (
        !classroom ||
        !code ||
        classroom.status !== 'active' ||
        code.revokedAt ||
        code.expiresAt <= now
      )
        throw codeInvalid();
      const [existing] = await tx
        .select()
        .from(classEnrolments)
        .where(and(eq(classEnrolments.classId, classroom.id), eq(classEnrolments.userId, actorId)))
        .for('update')
        .limit(1);
      if (existing?.status === 'suspended')
        throw new ClientError(
          'forbidden',
          'class_membership_suspended',
          'Bạn đã bị tạm dừng trong lớp',
        );
      if (existing?.status === 'active' || existing?.status === 'pending') {
        if (existing.status === 'active') await grantStudent(tx, classroom, actorId);
        return { classId: classroom.id, status: existing.status as 'active' | 'pending' };
      }
      if (code.maxUses !== null && code.usedCount >= code.maxUses) throw codeInvalid();
      const status: 'active' | 'pending' = classroom.joinMode === 'AUTO' ? 'active' : 'pending';
      if (existing) {
        await tx
          .update(classEnrolments)
          .set({
            status,
            updatedAt: now,
            updatedByUserId: actorId,
          })
          .where(
            and(eq(classEnrolments.classId, classroom.id), eq(classEnrolments.userId, actorId)),
          );
      } else {
        await tx.insert(classEnrolments).values({
          classId: classroom.id,
          userId: actorId,
          status,
          updatedByUserId: actorId,
        });
      }
      await tx
        .update(classJoinCodes)
        .set({ usedCount: sql`${classJoinCodes.usedCount} + 1` })
        .where(eq(classJoinCodes.id, code.id));
      if (status === 'active') await grantStudent(tx, classroom, actorId);
      return { classId: classroom.id, status };
    });
  }

  async listEnrolments(classId: string) {
    const rows = await this.db
      .select()
      .from(classEnrolments)
      .where(eq(classEnrolments.classId, classId));
    return rows.map(membership);
  }

  async changeEnrolment(
    classId: string,
    userId: string,
    actorId: string,
    action: 'approve' | 'suspend' | 'leave',
  ) {
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('update')
        .limit(1);
      if (!classroom) return undefined;
      if (action !== 'leave' && !(await classOwner(tx, classroom, actorId))) return undefined;
      if (action === 'leave' && actorId !== userId) return undefined;
      const [row] = await tx
        .select()
        .from(classEnrolments)
        .where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.userId, userId)))
        .for('update')
        .limit(1);
      if (!row) return undefined;
      if (action === 'approve' && (row.status !== 'pending' || classroom.status !== 'active'))
        return undefined;
      if (action === 'suspend' && row.status !== 'active' && row.status !== 'pending')
        return undefined;
      if (action === 'leave' && row.status === 'left') return undefined;
      const status = action === 'approve' ? 'active' : action === 'suspend' ? 'suspended' : 'left';
      const [updated] = await tx
        .update(classEnrolments)
        .set({
          status,
          updatedAt: new Date(),
          updatedByUserId: actorId,
        })
        .where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.userId, userId)))
        .returning();
      if (status === 'active') await grantStudent(tx, classroom, userId);
      else await revokeStudent(tx, classroom, userId);
      return membership(updated);
    });
  }
}
