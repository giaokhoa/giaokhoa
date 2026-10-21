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
import { hasSystemCapability, hasContextCapability } from './authorization.js';
import { authzContexts, authzRoleAssignments, authzRoles } from '../schema/authorization.js';
import { classes, classEnrolments, classJoinCodes } from '../schema/classes.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Tạo lỗi mã tham gia lớp không dùng được.
 * Không phân biệt mã không tồn tại, đã hết hạn hoặc bị thu hồi trong phản hồi trả về cho người tham gia.
 */
function codeInvalid(): ClientError {
  return new ClientError(
    'not_found',
    'class_join_code_invalid',
    'Mã tham gia không hợp lệ hoặc đã hết hạn',
  );
}

/**
 * Chuyển bản ghi thành viên lớp sang dữ liệu trả về hợp đồng nghiệp vụ.
 * Chỉ giữ trạng thái và các mốc thời gian cần thiết, không đưa mã người cập nhật ra ngoài.
 */
function membership(row: typeof classEnrolments.$inferSelect) {
  return classEnrolmentSchema.parse({
    userId: row.userId,
    status: row.status,
    joinedAt: row.joinedAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Chuyển bản ghi lớp thành cấu trúc công khai đã được xác thực.
 * Cố ý bỏ mã phạm vi phân quyền nội bộ vì đây không phải dữ liệu hồ sơ lớp dành cho người dùng.
 */
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

/**
 * Xác nhận tài khoản đăng nhập còn hoạt động trong giao dịch, không suy quyền từ hồ sơ đăng nhập.
 */
async function activeAccount(tx: Transaction, actorId: string) {
  const [actor] = await tx
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, actorId))
    .for('share')
    .limit(1);
  return !!actor && !actor.banned;
}

/** Người có capability hiệu lực tại lớp có thể quản lý; không bắt buộc là người tạo lớp. */
async function canManageClass(
  tx: Transaction,
  row: typeof classes.$inferSelect,
  actorId: string,
  capability: 'class:update' | 'class:enrolment_manage',
) {
  return (
    !!row.authzContextId &&
    (await activeAccount(tx, actorId)) &&
    (await hasContextCapability(tx, actorId, capability, { kind: 'class', resourceKey: row.id }))
  );
}

/**
 * Tìm vai trò học sinh trong phạm vi phân quyền của lớp.
 * Báo xung đột nếu chưa tạo phạm vi hoặc chưa khởi tạo vai trò cần thiết; không tự chèn vai trò thiếu trong lúc tham gia.
 */
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

/**
 * Cấp vai trò học sinh trong phạm vi lớp cho thành viên đã được chấp nhận.
 * Bỏ qua lần cấp trùng để việc đồng bộ quan hệ thành viên và phân quyền có thể chạy lặp lại an toàn.
 */
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

/**
 * Đánh dấu thu hồi vai trò học sinh khi thành viên rời lớp hoặc bị đình chỉ.
 * Chỉ thu hồi lần gán còn hiệu lực; giữ bản ghi cũ để truy vết các lần tham gia.
 */
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

/**
 * Lớp truy cập PostgreSQL để quản lý lớp học, thành viên và mã mời.
 * Các thao tác tham gia, phê duyệt hoặc đình chỉ dùng giao dịch và thứ tự khóa ổn định để giữ nhất quán quyền trong lớp.
 */
export class PostgresClassesRepository implements ClassesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Tạo lớp, phạm vi phân quyền và quyền chủ lớp trong cùng một giao dịch.
   * Yêu cầu capability tạo lớp trong phạm vi hệ thống; nếu thiếu cấu hình phân quyền gốc thì không tạo lớp dở dang.
   */
  async create(input: ClassCreate, actorId: string) {
    return this.db.transaction(async (tx) => {
      if (!(await hasSystemCapability(tx, actorId, 'class:create')))
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

  /**
   * Đọc thông tin hiển thị của lớp theo mã định danh.
   * Không đưa mã phạm vi phân quyền nội bộ vào dữ liệu trả về.
   */
  async findById(id: string) {
    const [row] = await this.db.select().from(classes).where(eq(classes.id, id)).limit(1);
    return row ? publicClass(row) : undefined;
  }

  /**
   * Sửa lớp khi người thực hiện có capability class:update tại ngữ cảnh lớp.
   * Khóa lớp trước khi kiểm tra và cập nhật để tránh tranh chấp với thay đổi trạng thái hoặc quyền tham gia.
   */
  async update(id: string, actorId: string, patch: ClassPatch) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, id))
        .for('update')
        .limit(1);
      if (!row || !(await canManageClass(tx, row, actorId, 'class:update'))) return undefined;
      const [updated] = await tx
        .update(classes)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(classes.id, id))
        .returning();
      return publicClass(updated);
    });
  }

  /**
   * Tạo mã mời đã băm cho lớp đang hoạt động và người có quyền cập nhật lớp.
   * Lưu thời hạn, giới hạn sử dụng và danh tính người cấp; không lưu mã mời nguyên bản trong cơ sở dữ liệu.
   */
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
      if (
        !row ||
        row.status !== 'active' ||
        !(await canManageClass(tx, row, actorId, 'class:update'))
      )
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

  /**
   * Thu hồi mã mời của đúng lớp khi người thực hiện có quyền quản lý.
   * Chỉ đánh dấu thời điểm thu hồi nếu mã chưa bị thu hồi; kết quả boolean cho biết có bản ghi được thay đổi.
   */
  async revokeJoinCode(classId: string, codeId: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('update')
        .limit(1);
      if (!classroom || !(await canManageClass(tx, classroom, actorId, 'class:update')))
        return false;
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
   * Khóa lần lượt lớp, mã mời và bản ghi tham gia lớp (enrolment) để kiểm tra hạn sử dụng,
   * cập nhật thành viên và cấp vai trò class:student trong cùng một giao dịch (transaction).
   * Thành viên đang chờ duyệt (pending) chưa được cấp vai trò này.
   */
  async join(codeHash: string, actorId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      if (!(await activeAccount(tx, actorId)))
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
      // Khóa lớp trước mã mời, cùng thứ tự với thao tác thu hồi để tránh kẹt khóa (deadlock).
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

  /**
   * Liệt kê tất cả quan hệ tham gia một lớp, gồm cả người chờ duyệt hoặc đã rời lớp.
   * Không tự lọc quyền xem ở đây; tầng nghiệp vụ phải xác minh người gọi có quyền quản lý danh sách.
   */
  async listEnrolments(classId: string) {
    const rows = await this.db
      .select()
      .from(classEnrolments)
      .where(eq(classEnrolments.classId, classId));
    return rows.map(membership);
  }

  /**
   * Duyệt, đình chỉ hoặc cho thành viên rời lớp bằng một thay đổi trạng thái nhất quán.
   * Duyệt và đình chỉ đòi quyền quản lý thành viên; rời lớp chỉ do chính thành viên thực hiện. Việc cấp hoặc thu hồi vai trò học sinh nằm cùng giao dịch với cập nhật thành viên.
   */
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
      if (
        action !== 'leave' &&
        !(await canManageClass(tx, classroom, actorId, 'class:enrolment_manage'))
      )
        return undefined;
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
      if (action === 'leave' && row.status === 'suspended')
        throw new ClientError(
          'forbidden',
          'class_membership_suspended',
          'Bạn đã bị tạm dừng trong lớp',
        );
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
