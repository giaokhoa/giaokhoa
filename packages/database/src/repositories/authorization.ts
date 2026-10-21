import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  AuthorizationContext,
  AuthorizationContextKind,
  AuthorizationRepository,
  ContextRef,
  ContextWithRoleInput,
  PermissionEffect,
  RoleAssignmentInput,
} from '@giaokhoa/application/authorization/repository';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import {
  authzCapabilities,
  authzContexts,
  authzRoleAssignments,
  authzRolePermissions,
  authzRoleOverrides,
  authzRoleContextLevels,
  authzRoleAllowAssignments,
  authzRoleAllowOverrides,
  authzRoles,
} from '../schema/authorization.js';
import { classes, classEnrolments } from '../schema/classes.js';
import type { Database } from '../types.js';

/**
 * Chuyển bản ghi phạm vi phân quyền (authorization context) thành kiểu dữ liệu của tầng nghiệp vụ.
 * Chỉ xuất các trường xác định tài nguyên và quan hệ cha; không để cấu trúc bảng rò sang giao diện nghiệp vụ.
 */
function contextRecord(row: typeof authzContexts.$inferSelect): AuthorizationContext {
  return {
    id: row.id,
    kind: row.kind as AuthorizationContextKind,
    resourceKey: row.resourceKey,
    parentId: row.parentId,
  };
}

/**
 * Tạo lỗi dữ liệu vai trò không hợp lệ tại phạm vi phân quyền đang xét.
 * Dùng chung khi vai trò không tồn tại, không phù hợp loại phạm vi hoặc không được phép cấp trực tiếp.
 */
function invalidRole() {
  return new ClientError(
    'invalid',
    'authorization_role_invalid',
    'Vai trò không hợp lệ tại context',
  );
}

/**
 * Lớp truy cập PostgreSQL phục vụ kiểm tra quyền theo vai trò và phạm vi tài nguyên.
 * Dùng một nguồn gán vai trò cho cả hệ thống và lớp, chỉ xét tài khoản và quyền còn hiệu lực.
 */
export class PostgresAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly db: Database) {}

  /**
   * Tìm phạm vi phân quyền theo loại tài nguyên và mã tài nguyên thay vì theo mã nội bộ.
   * Cặp thông tin này duy nhất trong cơ sở dữ liệu; trả về undefined khi chưa có phạm vi tương ứng.
   */
  async findContext(ref: ContextRef) {
    const [row] = await this.db
      .select()
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, ref.kind), eq(authzContexts.resourceKey, ref.resourceKey)))
      .limit(1);
    return row ? contextRecord(row) : undefined;
  }

  /**
   * Tìm phạm vi phân quyền bằng mã UUID đã lưu.
   * Trả về cấu trúc cha-con cần cho việc đi ngược cây phạm vi khi xét quyền; không tự suy đoán quyền từ bản ghi.
   */
  async findContextById(id: string) {
    const [row] = await this.db
      .select()
      .from(authzContexts)
      .where(eq(authzContexts.id, id))
      .limit(1);
    return row ? contextRecord(row) : undefined;
  }

  /**
   * Mọi vai trò hệ thống được cấp hoặc thu hồi qua authz_role_assignments, không đọc vai trò từ phiên đăng nhập.
   * Vai trò người dùng đã xác thực mặc định áp dụng ở system context. Vai trò học sinh tại lớp
   * hoặc hoạt động con chỉ có hiệu lực khi lớp cha và quan hệ ghi danh còn hoạt động.
   * Tài khoản bị khóa không được cấp quyền.
   */
  async findPermissions(actorId: string, capability: string, contextIds: string[]) {
    if (!contextIds.length) return [];
    const [actor] = await this.db
      .select({ banned: users.banned })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (!actor || actor.banned) return [];

    const active = await this.db
      .select({ roleId: authzRoles.id, contextId: authzRoleAssignments.contextId })
      .from(authzRoleAssignments)
      .innerJoin(authzRoles, eq(authzRoleAssignments.roleId, authzRoles.id))
      .leftJoin(authzContexts, eq(authzContexts.id, authzRoleAssignments.contextId))
      .leftJoin(
        classes,
        or(
          eq(classes.authzContextId, authzRoleAssignments.contextId),
          and(
            eq(authzContexts.kind, 'assignment'),
            eq(classes.authzContextId, authzContexts.parentId),
          ),
        ),
      )
      .leftJoin(
        classEnrolments,
        and(eq(classEnrolments.classId, classes.id), eq(classEnrolments.userId, actorId)),
      )
      .where(
        and(
          eq(authzRoleAssignments.userId, actorId),
          inArray(authzRoleAssignments.contextId, contextIds),
          isNull(authzRoleAssignments.revokedAt),
          or(
            ne(authzRoles.key, 'class:student'),
            and(eq(classEnrolments.status, 'active'), eq(classes.status, 'active')),
          ),
        ),
      );

    const root = await this.db
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(
        and(
          eq(authzContexts.kind, 'system'),
          eq(authzContexts.resourceKey, 'giaokhoa'),
          inArray(authzContexts.id, contextIds),
        ),
      )
      .limit(1);
    if (root.length) {
      const [authenticated] = await this.db
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, 'system:user'))
        .limit(1);
      if (authenticated) active.push({ roleId: authenticated.id, contextId: root[0].id });
    }
    if (!active.length) return [];

    const roleIds = [...new Set(active.map(({ roleId }) => roleId))];
    const defaults = await this.db
      .select({ roleId: authzRolePermissions.roleId, effect: authzRolePermissions.effect })
      .from(authzRolePermissions)
      .innerJoin(authzCapabilities, eq(authzRolePermissions.capabilityId, authzCapabilities.id))
      .where(
        and(inArray(authzRolePermissions.roleId, roleIds), eq(authzCapabilities.key, capability)),
      );
    const overrides = await this.db
      .select({
        roleId: authzRoleOverrides.roleId,
        contextId: authzRoleOverrides.contextId,
        effect: authzRoleOverrides.effect,
      })
      .from(authzRoleOverrides)
      .innerJoin(authzCapabilities, eq(authzRoleOverrides.capabilityId, authzCapabilities.id))
      .where(
        and(
          inArray(authzRoleOverrides.roleId, roleIds),
          inArray(authzRoleOverrides.contextId, contextIds),
          eq(authzCapabilities.key, capability),
        ),
      );

    const grants: { assignmentContextId: string; contextId: string; effect: PermissionEffect }[] =
      [];
    for (const assignment of active) {
      const applicable = overrides.filter(({ roleId }) => roleId === assignment.roleId);
      const closest = contextIds
        .map((id) => applicable.find((row) => row.contextId === id))
        .find((row) => row && row.effect !== 'INHERIT');
      const base = defaults.find(({ roleId }) => roleId === assignment.roleId);
      const effective =
        closest ?? (base && root[0] ? { contextId: root[0].id, effect: base.effect } : undefined);
      if (effective && effective.effect !== 'INHERIT')
        grants.push({
          assignmentContextId: assignment.contextId,
          contextId: effective.contextId,
          effect: effective.effect as PermissionEffect,
        });
      // PROHIBIT vẫn có hiệu lực tuyệt đối khi gặp ALLOW tại ngữ cảnh con.
      for (const hardDeny of applicable.filter(({ effect }) => effect === 'PROHIBIT'))
        grants.push({
          assignmentContextId: assignment.contextId,
          contextId: hardDeny.contextId,
          effect: 'PROHIBIT',
        });
      if (base?.effect === 'PROHIBIT' && root[0])
        grants.push({
          assignmentContextId: assignment.contextId,
          contextId: root[0].id,
          effect: 'PROHIBIT',
        });
    }
    return grants;
  }

  /** Quản lý vai trò: các thao tác ghi đều tái kiểm tra capability trong giao dịch. */
  async createRole(
    actorId: string,
    key: string,
    contextKind: 'system' | 'class',
    levels: AuthorizationContextKind[],
  ) {
    return this.db.transaction(async (tx) => {
      await assertRoleManager(tx, actorId);
      if (!levels.length) throw invalidRole();
      const inserted = await tx
        .insert(authzRoles)
        .values({ key, contextKind, isBuiltin: false })
        .onConflictDoNothing()
        .returning({ id: authzRoles.id });
      if (!inserted.length) return false;
      await tx
        .insert(authzRoleContextLevels)
        .values(
          [...new Set(levels)].map((contextKind) => ({ roleId: inserted[0].id, contextKind })),
        );
      return true;
    });
  }

  async setRolePermission(
    actorId: string,
    roleKey: string,
    capability: string,
    effect: PermissionEffect,
  ) {
    return this.db.transaction(async (tx) => {
      await assertRoleManager(tx, actorId);
      const [role] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, roleKey))
        .limit(1);
      const [cap] = await tx
        .select({ id: authzCapabilities.id })
        .from(authzCapabilities)
        .where(eq(authzCapabilities.key, capability))
        .limit(1);
      if (!role || !cap) throw invalidRole();
      const predicate = and(
        eq(authzRolePermissions.roleId, role.id),
        eq(authzRolePermissions.capabilityId, cap.id),
      );
      const [existing] = await tx
        .select({ effect: authzRolePermissions.effect })
        .from(authzRolePermissions)
        .where(predicate)
        .limit(1);
      if (effect === 'INHERIT') {
        if (!existing) return false;
        await tx.delete(authzRolePermissions).where(predicate);
        return true;
      }
      if (existing?.effect === effect) return false;
      await tx
        .insert(authzRolePermissions)
        .values({ roleId: role.id, capabilityId: cap.id, effect })
        .onConflictDoUpdate({
          target: [authzRolePermissions.roleId, authzRolePermissions.capabilityId],
          set: { effect },
        });
      return true;
    });
  }

  async setRoleContexts(actorId: string, roleKey: string, levels: AuthorizationContextKind[]) {
    return this.db.transaction(async (tx) => {
      await assertRoleManager(tx, actorId);
      if (!levels.length) throw invalidRole();
      const [role] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, roleKey))
        .limit(1);
      if (!role) throw invalidRole();
      const current = await tx
        .select({ kind: authzRoleContextLevels.contextKind })
        .from(authzRoleContextLevels)
        .where(eq(authzRoleContextLevels.roleId, role.id));
      const expected = [...new Set(levels)].sort();
      if (JSON.stringify(current.map((row) => row.kind).sort()) === JSON.stringify(expected))
        return false;
      await tx.delete(authzRoleContextLevels).where(eq(authzRoleContextLevels.roleId, role.id));
      await tx
        .insert(authzRoleContextLevels)
        .values(expected.map((contextKind) => ({ roleId: role.id, contextKind })));
      return true;
    });
  }

  async setRoleMatrix(
    actorId: string,
    actorRoleKey: string,
    targetRoleKey: string,
    action: 'assign' | 'override',
    allowed: boolean,
  ) {
    return this.db.transaction(async (tx) => {
      await assertRoleManager(tx, actorId);
      const found = await tx
        .select({ id: authzRoles.id, key: authzRoles.key })
        .from(authzRoles)
        .where(inArray(authzRoles.key, [actorRoleKey, targetRoleKey]));
      const source = found.find((role) => role.key === actorRoleKey);
      const target = found.find((role) => role.key === targetRoleKey);
      if (!source || !target) throw invalidRole();
      const matrix = action === 'assign' ? authzRoleAllowAssignments : authzRoleAllowOverrides;
      const predicate = and(eq(matrix.actorRoleId, source.id), eq(matrix.targetRoleId, target.id));
      if (allowed) {
        const inserted = await tx
          .insert(matrix)
          .values({ actorRoleId: source.id, targetRoleId: target.id })
          .onConflictDoNothing()
          .returning({ id: matrix.actorRoleId });
        return inserted.length > 0;
      }
      const removed = await tx
        .delete(matrix)
        .where(predicate)
        .returning({ id: matrix.actorRoleId });
      return removed.length > 0;
    });
  }

  /** Ma trận Moodle: capability cấp quyền chưa đủ nếu vai trò nguồn không được quản lý vai trò đích. */
  async canManageRole(
    actorId: string,
    roleKey: string,
    contextIds: string[],
    action: 'assign' | 'override',
  ): Promise<boolean> {
    if (!contextIds.length) return false;
    const [actor] = await this.db
      .select({ banned: users.banned })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (!actor || actor.banned) return false;
    const [role] = await this.db
      .select({ id: authzRoles.id })
      .from(authzRoles)
      .where(eq(authzRoles.key, roleKey))
      .limit(1);
    if (!role) return false;
    const matrix = action === 'assign' ? authzRoleAllowAssignments : authzRoleAllowOverrides;
    const [allowed] = await this.db
      .select({ id: authzRoleAssignments.id })
      .from(authzRoleAssignments)
      .innerJoin(
        matrix,
        and(eq(matrix.actorRoleId, authzRoleAssignments.roleId), eq(matrix.targetRoleId, role.id)),
      )
      .where(
        and(
          eq(authzRoleAssignments.userId, actorId),
          inArray(authzRoleAssignments.contextId, contextIds),
          isNull(authzRoleAssignments.revokedAt),
        ),
      )
      .limit(1);
    return !!allowed;
  }

  /** Kiểm tra capability và ma trận lần nữa ngay trong giao dịch thay đổi quyền. */
  async setRoleOverride(
    contextId: string,
    roleKey: string,
    capability: string,
    effect: PermissionEffect,
    actorId: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [context] = await tx
        .select()
        .from(authzContexts)
        .where(eq(authzContexts.id, contextId))
        .limit(1);
      if (!context || context.kind === 'system') throw invalidRole();
      const allowed = await hasContextCapability(tx, actorId, 'role:override', {
        kind: context.kind as AuthorizationContextKind,
        resourceKey: context.resourceKey,
      });
      const scopes = await contextPath(tx, contextId);
      if (
        !allowed ||
        !(await new PostgresAuthorizationRepository(tx as unknown as Database).canManageRole(
          actorId,
          roleKey,
          scopes,
          'override',
        ))
      )
        throw new ClientError('forbidden', 'authorization_denied', 'Không được ghi đè vai trò');
      const [role] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, roleKey))
        .limit(1);
      const [cap] = await tx
        .select({ id: authzCapabilities.id })
        .from(authzCapabilities)
        .where(eq(authzCapabilities.key, capability))
        .limit(1);
      if (!role || !cap) throw invalidRole();
      if (effect === 'INHERIT') {
        const removed = await tx
          .delete(authzRoleOverrides)
          .where(
            and(
              eq(authzRoleOverrides.roleId, role.id),
              eq(authzRoleOverrides.capabilityId, cap.id),
              eq(authzRoleOverrides.contextId, contextId),
            ),
          )
          .returning({ id: authzRoleOverrides.roleId });
        return removed.length > 0;
      }
      const [previous] = await tx
        .select({ effect: authzRoleOverrides.effect })
        .from(authzRoleOverrides)
        .where(
          and(
            eq(authzRoleOverrides.roleId, role.id),
            eq(authzRoleOverrides.capabilityId, cap.id),
            eq(authzRoleOverrides.contextId, contextId),
          ),
        )
        .limit(1);
      if (previous?.effect === effect) return false;
      await tx
        .insert(authzRoleOverrides)
        .values({ roleId: role.id, capabilityId: cap.id, contextId, effect })
        .onConflictDoUpdate({
          target: [
            authzRoleOverrides.roleId,
            authzRoleOverrides.capabilityId,
            authzRoleOverrides.contextId,
          ],
          set: { effect },
        });
      return true;
    });
  }

  /**
   * Tạo phạm vi lớp học và cấp vai trò ban đầu cho người dùng trong một giao dịch.
   * Bắt buộc phạm vi cha là hệ thống chính và vai trò phù hợp loại lớp; hai bước thêm phạm vi và gán vai trò phải cùng thành công để tránh phạm vi thiếu chủ.
   */
  async createContextWithRole(input: ContextWithRoleInput) {
    if (input.context.kind !== 'class')
      throw new ClientError(
        'invalid',
        'authorization_context_invalid',
        'Chỉ hỗ trợ khởi tạo Class context',
      );

    return this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(authzContexts)
        .where(eq(authzContexts.id, input.context.parentId))
        .limit(1);
      if (!parent || parent.kind !== 'system' || parent.resourceKey !== 'giaokhoa')
        throw new ClientError(
          'invalid',
          'authorization_parent_invalid',
          'Context cha không hợp lệ',
        );

      const [role] = await tx
        .select()
        .from(authzRoles)
        .where(eq(authzRoles.key, input.roleKey))
        .limit(1);
      if (
        !role ||
        !(
          await tx
            .select({ roleId: authzRoleContextLevels.roleId })
            .from(authzRoleContextLevels)
            .where(
              and(
                eq(authzRoleContextLevels.roleId, role.id),
                eq(authzRoleContextLevels.contextKind, input.context.kind),
              ),
            )
            .limit(1)
        ).length
      )
        throw invalidRole();

      const [created] = await tx
        .insert(authzContexts)
        .values({
          kind: input.context.kind,
          resourceKey: input.context.resourceKey,
          parentId: input.context.parentId,
        })
        .returning();
      await tx.insert(authzRoleAssignments).values({
        userId: input.userId,
        roleId: role.id,
        contextId: created.id,
        source: input.source,
        grantedByUserId: input.grantedByUserId,
      });
      return contextRecord(created);
    });
  }

  /**
   * Cấp vai trò trong phạm vi tài nguyên sau khi kiểm tra loại vai trò tương thích.
   * Vai trò hệ thống và lớp đều dùng một nguồn gán vai trò; ràng buộc duy nhất ngăn cấp trùng.
   * Trả về true khi tạo được lần gán đang có hiệu lực, false khi đã tồn tại.
   */
  async assignRole(input: RoleAssignmentInput) {
    return this.db.transaction(async (tx) => {
      const [context] = await tx
        .select()
        .from(authzContexts)
        .where(eq(authzContexts.id, input.contextId))
        .limit(1);
      const [role] = await tx
        .select()
        .from(authzRoles)
        .where(eq(authzRoles.key, input.roleKey))
        .limit(1);
      if (
        !context ||
        !role ||
        !(
          await tx
            .select({ roleId: authzRoleContextLevels.roleId })
            .from(authzRoleContextLevels)
            .where(
              and(
                eq(authzRoleContextLevels.roleId, role.id),
                eq(authzRoleContextLevels.contextKind, context.kind),
              ),
            )
            .limit(1)
        ).length
      )
        throw invalidRole();
      // Ngay cả khi tầng dịch vụ đã cho phép, thao tác ghi phải kiểm capability và ma trận role trong giao dịch.
      if (input.source === 'system_administrator' || input.source === 'context_delegation') {
        const scopes = await contextPath(tx, context.id);
        const authorized =
          !!input.grantedByUserId &&
          (await hasContextCapability(
            tx,
            input.grantedByUserId,
            context.kind === 'system' ? 'role:assign_system' : 'role:assign',
            { kind: context.kind as AuthorizationContextKind, resourceKey: context.resourceKey },
          )) &&
          (await new PostgresAuthorizationRepository(tx as unknown as Database).canManageRole(
            input.grantedByUserId,
            input.roleKey,
            scopes,
            'assign',
          ));
        if (!authorized)
          throw new ClientError('forbidden', 'authorization_denied', 'Không được cấp vai trò này');
      }
      const [target] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target)
        throw new ClientError(
          'not_found',
          'authorization_user_not_found',
          'Tài khoản không tồn tại',
        );

      const inserted = await tx
        .insert(authzRoleAssignments)
        .values({
          userId: input.userId,
          roleId: role.id,
          contextId: input.contextId,
          source: input.source,
          grantedByUserId: input.grantedByUserId,
        })
        .onConflictDoNothing()
        .returning({ id: authzRoleAssignments.id });
      return inserted.length > 0;
    });
  }

  /**
   * Thu hồi vai trò bằng cách ghi thời điểm thu hồi thay vì xóa bản ghi.
   * Chỉ tác động đến lần gán chưa thu hồi trong đúng phạm vi, đúng người dùng và đúng vai trò; giữ lịch sử cho việc kiểm tra quyền về sau.
   */
  async revokeRole(contextId: string, userId: string, roleKey: string, authorizedBy?: string) {
    return this.db.transaction(async (tx) => {
      if (authorizedBy) {
        const [context] = await tx
          .select()
          .from(authzContexts)
          .where(eq(authzContexts.id, contextId))
          .limit(1);
        const scopes = context ? await contextPath(tx, context.id) : [];
        const authorized =
          !!context &&
          (await hasContextCapability(
            tx,
            authorizedBy,
            context.kind === 'system' ? 'role:assign_system' : 'role:assign',
            { kind: context.kind as AuthorizationContextKind, resourceKey: context.resourceKey },
          )) &&
          (await new PostgresAuthorizationRepository(tx as unknown as Database).canManageRole(
            authorizedBy,
            roleKey,
            scopes,
            'assign',
          ));
        if (!authorized)
          throw new ClientError(
            'forbidden',
            'authorization_denied',
            'Không được thu hồi vai trò này',
          );
      }
      const [role] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, roleKey))
        .limit(1);
      if (!role) return false;
      const revoked = await tx
        .update(authzRoleAssignments)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authzRoleAssignments.contextId, contextId),
            eq(authzRoleAssignments.userId, userId),
            eq(authzRoleAssignments.roleId, role.id),
            isNull(authzRoleAssignments.revokedAt),
          ),
        )
        .returning({ id: authzRoleAssignments.id });
      return revoked.length > 0;
    });
  }
}

/** Dùng cùng bộ xét quyền của tầng ứng dụng ngay trong giao dịch đang ghi dữ liệu. */
export async function hasContextCapability(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  actorId: string,
  capability: string,
  context: ContextRef,
): Promise<boolean> {
  return (
    await new AuthorizationService(
      new PostgresAuthorizationRepository(tx as unknown as Database),
    ).authorize({ actorId, capability, context })
  ).allowed;
}

export async function hasSystemCapability(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  actorId: string,
  capability: string,
) {
  return hasContextCapability(tx, actorId, capability, { kind: 'system', resourceKey: 'giaokhoa' });
}

/** Chuỗi từ ngữ cảnh hiện tại về gốc, dùng cho ma trận gán và ghi đè vai trò. */
async function contextPath(tx: Parameters<Parameters<Database['transaction']>[0]>[0], id: string) {
  const path: string[] = [];
  let current: string | null = id;
  while (current && path.length < 32) {
    if (path.includes(current)) return [];
    path.push(current);
    const [row]: { parentId: string | null }[] = await tx
      .select({ parentId: authzContexts.parentId })
      .from(authzContexts)
      .where(eq(authzContexts.id, current))
      .limit(1);
    if (!row) return [];
    current = row.parentId;
  }
  return current ? [] : path;
}

/** Ngăn đường cập nhật vai trò bỏ qua policy tại tầng ứng dụng khi bị gọi trực tiếp. */
async function assertRoleManager(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  actorId: string,
) {
  if (!(await hasSystemCapability(tx, actorId, 'role:manage')))
    throw new ClientError(
      'forbidden',
      'authorization_denied',
      'Không được quản lý định nghĩa vai trò',
    );
}
