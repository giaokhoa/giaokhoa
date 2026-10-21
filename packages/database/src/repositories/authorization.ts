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
   * Vai trò người dùng đã xác thực mặc định áp dụng ở system context; vai trò học sinh chỉ có
   * hiệu lực khi lớp và quan hệ tham gia hoạt động. Tài khoản bị khóa không được cấp quyền.
   */
  async findPermissions(actorId: string, capability: string, contextIds: string[]) {
    if (contextIds.length === 0) return [];
    const [actor] = await this.db
      .select({ banned: users.banned })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (!actor || actor.banned) return [];

    const scoped = await this.db
      .select({ contextId: authzRoleAssignments.contextId, effect: authzRolePermissions.effect })
      .from(authzRoleAssignments)
      .innerJoin(authzRoles, eq(authzRoleAssignments.roleId, authzRoles.id))
      .leftJoin(classes, eq(classes.authzContextId, authzRoleAssignments.contextId))
      .leftJoin(
        classEnrolments,
        and(eq(classEnrolments.classId, classes.id), eq(classEnrolments.userId, actorId)),
      )
      .innerJoin(authzRolePermissions, eq(authzRolePermissions.roleId, authzRoles.id))
      .innerJoin(authzCapabilities, eq(authzRolePermissions.capabilityId, authzCapabilities.id))
      .where(
        and(
          eq(authzRoleAssignments.userId, actorId),
          inArray(authzRoleAssignments.contextId, contextIds),
          isNull(authzRoleAssignments.revokedAt),
          eq(authzCapabilities.key, capability),
          or(
            ne(authzRoles.key, 'class:student'),
            and(eq(classEnrolments.status, 'active'), eq(classes.status, 'active')),
          ),
        ),
      );

    const grants = scoped.map((row) => ({
      contextId: row.contextId,
      effect: row.effect as PermissionEffect,
    }));
    const [systemContext] = await this.db
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
    if (!systemContext) return grants;

    // Giống vai trò mặc định 'authenticated user' của Moodle: áp dụng cho mọi tài khoản hoạt động.
    const system = await this.db
      .select({ effect: authzRolePermissions.effect })
      .from(authzRoles)
      .innerJoin(authzRolePermissions, eq(authzRolePermissions.roleId, authzRoles.id))
      .innerJoin(authzCapabilities, eq(authzRolePermissions.capabilityId, authzCapabilities.id))
      .where(and(eq(authzRoles.key, 'system:user'), eq(authzCapabilities.key, capability)));
    return [
      ...grants,
      ...system.map((row) => ({
        contextId: systemContext.id,
        effect: row.effect as PermissionEffect,
      })),
    ];
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
      if (!role || role.contextKind !== input.context.kind) throw invalidRole();

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
      if (!context || !role || context.kind !== role.contextKind) throw invalidRole();
      if (input.source === 'system_administrator') {
        if (
          !input.grantedByUserId ||
          !(await hasSystemCapability(tx, input.grantedByUserId, 'role:assign_system'))
        )
          throw new ClientError(
            'forbidden',
            'authorization_denied',
            'Không được cấp vai trò hệ thống',
          );
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
      if (authorizedBy && !(await hasSystemCapability(tx, authorizedBy, 'role:assign_system')))
        throw new ClientError(
          'forbidden',
          'authorization_denied',
          'Không được thu hồi vai trò hệ thống',
        );
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
export async function hasSystemCapability(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  actorId: string,
  capability: string,
): Promise<boolean> {
  const authorization = new AuthorizationService(
    new PostgresAuthorizationRepository(tx as unknown as Database),
  );
  return (
    await authorization.authorize({
      actorId,
      capability,
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    })
  ).allowed;
}
