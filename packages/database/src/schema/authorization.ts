import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';

/**
 * Biểu diễn phạm vi phân quyền (authorization context) cho hệ thống, người dùng, ngân hàng câu hỏi và từng tài nguyên.
 * Quan hệ cha-con cho phép tra quyền từ tài nguyên cụ thể lên phạm vi cao hơn; bộ đôi loại và khóa tài nguyên phải duy nhất.
 */
export const authzContexts = pgTable(
  'authz_contexts',
  {
    /**
     * Mã phạm vi phân quyền duy nhất, được PostgreSQL cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Loại phạm vi: hệ thống, người dùng, ngân hàng câu hỏi, câu hỏi, đề thi, lớp học hoặc bài giao; SQL giới hạn các giá trị được phép.
     */
    kind: text('kind').notNull(),
    /**
     * Mã tài nguyên trong loại phạm vi tương ứng; kết hợp với loại phạm vi để không tạo hai phạm vi cho cùng tài nguyên.
     */
    resourceKey: text('resource_key').notNull(),
    /**
     * Phạm vi cha để kế thừa và xét quyền theo cây; để trống đối với phạm vi gốc và không được trỏ đến chính mình.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => authzContexts.id),
    /**
     * Thời điểm phạm vi được tạo, phục vụ truy vết vòng đời phân quyền.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('authz_contexts_kind_resource_unique').on(table.kind, table.resourceKey),
    index('authz_contexts_parent_idx').on(table.parentId),
    check(
      'authz_contexts_kind_check',
      sql`${table.kind} in ('system', 'user', 'bank', 'question', 'exam', 'class', 'assignment')`,
    ),
    check(
      'authz_contexts_parent_not_self_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  ],
);

/**
 * Danh mục vai trò (role) dùng để gom các quyền mà người dùng có thể được cấp trong một phạm vi.
 * Tách vai trò khỏi người dùng để nhiều người dùng cùng sử dụng một định nghĩa quyền nhất quán.
 */
export const authzRoles = pgTable(
  'authz_roles',
  {
    /**
     * Mã vai trò duy nhất, do PostgreSQL cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Mã vai trò ổn định và không trùng, được code nghiệp vụ dùng để tra cứu.
     */
    key: text('key').notNull().unique(),
    /**
     * Phân loại mặc định cho vai trò dựng sẵn; ngữ cảnh được phép cấp thực tế nằm trong authz_role_context_levels.
     */
    contextKind: text('context_kind').notNull(),
    /**
     * Đánh dấu vai trò dựng sẵn của hệ thống; mặc định là có để phân biệt với vai trò có thể được bổ sung sau này.
     */
    isBuiltin: boolean('is_builtin').default(true).notNull(),
  },
  (table) => [
    check('authz_roles_context_kind_check', sql`${table.contextKind} in ('system', 'class')`),
  ],
);

/** Các loại ngữ cảnh được phép gán từng vai trò, tương đương archetype context levels của Moodle. */
export const authzRoleContextLevels = pgTable(
  'authz_role_context_levels',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => authzRoles.id),
    contextKind: text('context_kind').notNull(),
  },
  (table) => [
    unique('authz_role_context_levels_unique').on(table.roleId, table.contextKind),
    check(
      'authz_role_context_levels_kind_check',
      sql`${table.contextKind} in ('system', 'user', 'bank', 'question', 'exam', 'class', 'assignment')`,
    ),
  ],
);

/** Ma trận Moodle: vai trò nào được cấp vai trò nào; capability cấp quyền chưa đủ để vượt ma trận. */
export const authzRoleAllowAssignments = pgTable(
  'authz_role_allow_assignments',
  {
    actorRoleId: uuid('actor_role_id')
      .notNull()
      .references(() => authzRoles.id),
    targetRoleId: uuid('target_role_id')
      .notNull()
      .references(() => authzRoles.id),
  },
  (table) => [
    unique('authz_role_allow_assignments_unique').on(table.actorRoleId, table.targetRoleId),
  ],
);

/** Ma trận Moodle: giới hạn các vai trò mà một vai trò được phép ghi đè quyền. */
export const authzRoleAllowOverrides = pgTable(
  'authz_role_allow_overrides',
  {
    actorRoleId: uuid('actor_role_id')
      .notNull()
      .references(() => authzRoles.id),
    targetRoleId: uuid('target_role_id')
      .notNull()
      .references(() => authzRoles.id),
  },
  (table) => [
    unique('authz_role_allow_overrides_unique').on(table.actorRoleId, table.targetRoleId),
  ],
);

/**
 * Danh mục khả năng thực hiện thao tác (capability) mà hệ thống kiểm soát qua phân quyền.
 * Định nghĩa khả năng một lần rồi liên kết với nhiều vai trò để tránh nhân bản tên quyền và ý nghĩa của chúng.
 */
export const authzCapabilities = pgTable(
  'authz_capabilities',
  {
    /**
     * Mã khả năng duy nhất, do PostgreSQL tự cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Mã khả năng ổn định, chẳng hạn quyền quản trị nền tảng; phải duy nhất để các thao tác kiểm tra quyền dùng cùng một tên.
     */
    key: text('key').notNull().unique(),
    /**
     * Loại phạm vi áp dụng khả năng: hệ thống (system) hoặc lớp học (class).
     */
    contextKind: text('context_kind').notNull(),
    /**
     * Mô tả ý nghĩa khả năng cho việc quản trị và rà soát quyền; không dùng làm khóa nhận dạng.
     */
    description: text('description').notNull(),
  },
  (table) => [
    check(
      'authz_capabilities_context_kind_check',
      sql`${table.contextKind} in ('system', 'class')`,
    ),
  ],
);

/**
 * Xác định tác động của một vai trò lên một khả năng tại phạm vi thích hợp.
 * Cặp vai trò và khả năng chỉ được định nghĩa một lần; kết quả cho phép hay từ chối còn phụ thuộc cây phạm vi và các vai trò đang được cấp.
 */
export const authzRolePermissions = pgTable(
  'authz_role_permissions',
  {
    /**
     * Vai trò nhận quy tắc quyền này; tham chiếu đến danh mục vai trò.
     */
    roleId: uuid('role_id')
      .notNull()
      .references(() => authzRoles.id),
    /**
     * Khả năng được điều khiển bởi quy tắc này; tham chiếu đến danh mục khả năng.
     */
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => authzCapabilities.id),
    /**
     * Cách xử lý quyền: kế thừa (INHERIT), cho phép (ALLOW), ngăn (PREVENT) hoặc cấm tuyệt đối (PROHIBIT).
     * Tầng nghiệp vụ ưu tiên lệnh cấm tuyệt đối trên toàn cây; ở cùng cấp, cho phép từ vai trò khác thắng ngăn.
     */
    effect: text('effect').notNull(),
  },
  (table) => [
    unique('authz_role_permissions_role_capability_unique').on(table.roleId, table.capabilityId),
    check(
      'authz_role_permissions_effect_check',
      sql`${table.effect} in ('INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT')`,
    ),
  ],
);

/** Quyền ghi đè cho một vai trò tại một ngữ cảnh cụ thể; không sửa định nghĩa vai trò toàn cục. */
export const authzRoleOverrides = pgTable(
  'authz_role_overrides',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => authzRoles.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => authzCapabilities.id),
    contextId: uuid('context_id')
      .notNull()
      .references(() => authzContexts.id, { onDelete: 'cascade' }),
    effect: text('effect').notNull(),
  },
  (table) => [
    unique('authz_role_overrides_unique').on(table.roleId, table.capabilityId, table.contextId),
    index('authz_role_overrides_context_idx').on(table.contextId),
    check(
      'authz_role_overrides_effect_check',
      sql`${table.effect} in ('INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT')`,
    ),
  ],
);

/**
 * Ghi nhận việc gán vai trò cho một người dùng tại một phạm vi cụ thể và lưu lịch sử thu hồi.
 * Chỉ cho phép một lần gán đang có hiệu lực cho cùng bộ người dùng, vai trò và phạm vi; bản đã thu hồi được giữ để truy vết.
 */
export const authzRoleAssignments = pgTable(
  'authz_role_assignments',
  {
    /**
     * Mã sự kiện gán vai trò duy nhất, được PostgreSQL cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Người dùng được gán vai trò và hưởng các quyền tương ứng.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Vai trò được cấp cho người dùng tại phạm vi đã chọn.
     */
    roleId: uuid('role_id')
      .notNull()
      .references(() => authzRoles.id),
    /**
     * Phạm vi tài nguyên mà lần gán vai trò có hiệu lực; dùng khi xét quyền theo cây phạm vi.
     */
    contextId: uuid('context_id')
      .notNull()
      .references(() => authzContexts.id),
    /**
     * Nguồn hoặc lý do phát sinh lần gán, để phân biệt việc cấp quyền theo cơ chế nào.
     */
    source: text('source').notNull(),
    /**
     * Tài khoản thực hiện cấp vai trò; có thể trống đối với lần cấp tự động của hệ thống.
     */
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    /**
     * Thời điểm cấp vai trò, dùng trong lịch sử phân quyền.
     */
    grantedAt: timestamp('granted_at').defaultNow().notNull(),
    /**
     * Thời điểm thu hồi; để trống nghĩa là lần gán còn hiệu lực và thuộc ràng buộc duy nhất của các lần gán đang hoạt động.
     */
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('authz_role_assignments_active_unique')
      .on(table.userId, table.roleId, table.contextId)
      .where(sql`${table.revokedAt} is null`),
    index('authz_role_assignments_context_idx').on(table.contextId),
    index('authz_role_assignments_user_idx').on(table.userId),
  ],
);
