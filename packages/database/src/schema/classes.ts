import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { authzContexts } from './authorization.js';

/**
 * Lớp học do giáo viên tạo, dùng để quản lý thành viên và phân phối bài giao.
 * Phạm vi phân quyền (authorization context) riêng cho phép kiểm tra quyền theo từng lớp thay vì dùng quyền toàn hệ thống.
 */
export const classes = pgTable(
  'classes',
  {
    /**
     * Mã lớp học duy nhất; PostgreSQL tự cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Tên lớp dùng để nhận biết trong danh sách; ràng buộc từ chối tên chỉ chứa khoảng trắng.
     */
    name: text('name').notNull(),
    /**
     * Tài khoản tạo lớp, tham chiếu đến người dùng để xác định quyền quản lý ban đầu.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Phạm vi phân quyền gắn riêng với lớp; có thể trống trước khi hoàn tất tạo phạm vi và phải duy nhất khi đã có.
     */
    authzContextId: uuid('authz_context_id')
      .unique()
      .references(() => authzContexts.id),
    /**
     * Tình trạng lớp: đang hoạt động (active) hoặc đã lưu trữ (archived); lớp lưu trữ không còn được sử dụng như lớp đang mở.
     */
    status: text('status').default('active').notNull(),
    /**
     * Cách gia nhập lớp: tự động (AUTO) hoặc cần phê duyệt (APPROVAL).
     */
    joinMode: text('join_mode').notNull(),
    /**
     * Thời điểm tạo lớp, được PostgreSQL tự đặt khi thêm bản ghi.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /**
     * Thời điểm lớp được cập nhật gần nhất, do tầng lưu trữ cập nhật khi thông tin thay đổi.
     */
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('classes_created_by_idx').on(table.createdByUserId),
    check('classes_status_check', sql`${table.status} in ('active', 'archived')`),
    check('classes_join_mode_check', sql`${table.joinMode} in ('AUTO', 'APPROVAL')`),
    check('classes_name_check', sql`length(trim(${table.name})) > 0`),
  ],
);

/**
 * Theo dõi quan hệ tham gia lớp học giữa một người dùng và một lớp.
 * Khóa chính ghép giữ một bản ghi thành viên cho mỗi cặp lớp và người dùng, kể cả khi thành viên chuyển trạng thái.
 */
export const classEnrolments = pgTable(
  'class_enrolments',
  {
    /**
     * Lớp học mà người dùng tham gia; là một phần khóa chính ghép.
     */
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    /**
     * Người tham gia lớp; là phần còn lại của khóa chính ghép.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Trạng thái tham gia: chờ duyệt (pending), đang tham gia (active), bị đình chỉ (suspended) hoặc đã rời lớp (left).
     */
    status: text('status').notNull(),
    /**
     * Thời điểm tạo quan hệ tham gia; lưu lịch sử thời gian gia nhập ngay cả khi trạng thái thay đổi.
     */
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    /**
     * Thời điểm gần nhất trạng thái thành viên được cập nhật.
     */
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    /**
     * Tài khoản thực hiện thay đổi trạng thái gần nhất; có thể trống khi thao tác không do một người dùng xác định thực hiện.
     */
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.classId, table.userId] }),
    index('class_enrolments_user_idx').on(table.userId),
    check(
      'class_enrolments_status_check',
      sql`${table.status} in ('pending', 'active', 'suspended', 'left')`,
    ),
  ],
);

/**
 * Quản lý mã mời tham gia lớp, thời hạn và giới hạn số lượt dùng.
 * Chỉ lưu giá trị băm (hash) của mã, không lưu mã gốc; cho phép thu hồi mã mà không phải xóa lịch sử.
 */
export const classJoinCodes = pgTable(
  'class_join_codes',
  {
    /**
     * Mã bản ghi lời mời duy nhất, được PostgreSQL cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Lớp học mà mã mời cho phép đăng ký tham gia.
     */
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    /**
     * Giá trị băm của mã mời; phải duy nhất để đối chiếu mã mà không lưu bí mật ở dạng rõ.
     */
    codeHash: text('code_hash').notNull(),
    /**
     * Thời điểm mã mời hết hiệu lực; lớp không chấp nhận mã sau mốc này.
     */
    expiresAt: timestamp('expires_at').notNull(),
    /**
     * Thời điểm mã mời bị thu hồi trước hạn; để trống nếu chưa thu hồi.
     */
    revokedAt: timestamp('revoked_at'),
    /**
     * Số lượt sử dụng tối đa; để trống nghĩa là không đặt giới hạn theo số lượt.
     */
    maxUses: integer('max_uses'),
    /**
     * Số lượt sử dụng đã ghi nhận; khởi tạo bằng 0 và không được âm.
     */
    usedCount: integer('used_count').default(0).notNull(),
    /**
     * Người tạo mã mời, phục vụ xác định chủ thể đã cấp quyền tham gia.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Thời điểm phát hành mã mời, do PostgreSQL tự ghi nhận.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('class_join_codes_hash_unique').on(table.codeHash),
    index('class_join_codes_class_idx').on(table.classId),
    check('class_join_codes_max_uses_check', sql`${table.maxUses} is null or ${table.maxUses} > 0`),
    check('class_join_codes_used_count_check', sql`${table.usedCount} >= 0`),
  ],
);
