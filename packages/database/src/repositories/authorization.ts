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
 * Kết hợp vai trò hệ thống của Better Auth với quan hệ thành viên lớp để không cấp quyền từ bản ghi đã hết hiệu lực.
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
   * Trường users.role của Better Auth là nguồn cấp vai trò ở phạm vi hệ thống (system);
   * không tạo thêm bản ghi gán vai trò trùng lặp tại phạm vi này.
   * Vai trò học sinh chỉ có hiệu lực khi quan hệ tham gia (enrolment) và lớp đều hoạt động;
   * tài khoản bị cấm hoặc có vai trò không được nhận diện sẽ không được cấp quyền.
   */
  async findPermissions(actorId: string, capability: string, contextIds: string[]) {
    if (contextIds.length === 0) return [];
    const [actor] = await this.db
      .select({ role: users.role, banned: users.banned })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (!actor || actor.banned) return [];
    if (actor.role !== 'user' && actor.role !== 'teacher' && actor.role !== 'admin') return [];

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
          // Khi tài khoản không còn là giáo viên, chỉ cấp quyền học sinh;
          // vẫn giữ bản ghi gán vai trò quản lý lớp để khôi phục hiệu lực khi trở lại vai trò giáo viên.
          actor.role === 'user' ? eq(authzRoles.key, 'class:student') : undefined,
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

    const system = await this.db
      .select({ effect: authzRolePermissions.effect })
      .from(authzRoles)
      .innerJoin(authzRolePermissions, eq(authzRolePermissions.roleId, authzRoles.id))
      .innerJoin(authzCapabilities, eq(authzRolePermissions.capabilityId, authzCapabilities.id))
      .where(
        and(eq(authzRoles.key, `system:${actor.role}`), eq(authzCapabilities.key, capability)),
      );
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
   * Không cấp vai trò hệ thống qua bảng gán này vì quyền hệ thống do Better Auth quản lý; ràng buộc duy nhất giúp việc cấp trùng không tạo bản ghi mới.
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
      if (!context || !role || context.kind !== role.contextKind || context.kind === 'system')
        throw invalidRole();

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
  async revokeRole(contextId: string, userId: string, roleKey: string) {
    return this.db.transaction(async (tx) => {
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
