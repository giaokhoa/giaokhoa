import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { classes } from './classes.js';
import { examRevisions } from './exams.js';

/**
 * Bài giao (assignment) đưa một phiên bản đề thi đã chốt tới một lớp học trong khoảng thời gian xác định.
 * Chính sách người nhận, số lần làm và lịch công bố kết quả được lưu cùng bài giao để mọi lượt làm dùng chung một bộ quy tắc.
 */
export const assignments = pgTable(
  'assignments',
  {
    /**
     * Mã bài giao duy nhất, được PostgreSQL tự cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Lớp nhận bài giao; hạn chế xóa lớp khi vẫn có bài giao để không làm mất liên kết và lịch sử học tập.
     */
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    /**
     * Phiên bản đề thi cụ thể dùng cho bài giao; không cho xóa phiên bản đề còn được bài giao tham chiếu.
     */
    examRevisionId: uuid('exam_revision_id')
      .notNull()
      .references(() => examRevisions.id, { onDelete: 'restrict' }),
    /**
     * Tài khoản tạo bài giao, dùng để xác định quyền quản lý và truy vết.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Phương thức chọn người nhận: cả lớp (ALL_CLASS) hoặc chọn người dùng (SELECTED_USERS); được kiểm tra bằng ràng buộc SQL.
     */
    audienceMode: text('audience_mode').notNull(),
    /**
     * Danh sách mã người dùng được chỉ định khi chọn theo danh sách; lưu dưới dạng mảng JSON để giữ cấu hình đối tượng nhận.
     */
    selectedUserIds: jsonb('selected_user_ids').$type<string[]>().notNull().default([]),
    /**
     * Trạng thái bài giao: bản nháp (draft) hoặc đã công bố (published); ban đầu là bản nháp.
     */
    status: text('status').notNull().default('draft'),
    /**
     * Thời điểm bắt đầu cho phép học sinh làm bài; phải sớm hơn thời điểm đóng.
     */
    openAt: timestamp('open_at').notNull(),
    /**
     * Thời điểm đóng bài, kết thúc khoảng thời gian làm bài; phải muộn hơn thời điểm mở.
     */
    closeAt: timestamp('close_at').notNull(),
    /**
     * Giới hạn số lượt làm của mỗi người nhận; mặc định một lượt và không thể bằng 0.
     */
    maxAttempts: integer('max_attempts').notNull().default(1),
    /**
     * Thời điểm cho phép học sinh xem điểm; để trống khi chưa có lịch công bố điểm.
     */
    releaseScoreAt: timestamp('release_score_at'),
    /**
     * Thời điểm cho phép xem nhận xét chấm bài; độc lập với thời điểm công bố điểm.
     */
    releaseFeedbackAt: timestamp('release_feedback_at'),
    /**
     * Thời điểm cho phép xem đáp án và lời giải; tách riêng để tránh tiết lộ đáp án quá sớm.
     */
    releaseSolutionsAt: timestamp('release_solutions_at'),
    /**
     * Thời điểm lập bài giao, do PostgreSQL tự đặt.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /**
     * Thời điểm bài giao được công bố cho người nhận; để trống khi chưa công bố.
     */
    publishedAt: timestamp('published_at'),
  },
  (table) => [
    index('assignments_class_idx').on(table.classId),
    index('assignments_exam_revision_idx').on(table.examRevisionId),
    check(
      'assignments_audience_check',
      sql`${table.audienceMode} in ('ALL_CLASS', 'SELECTED_USERS')`,
    ),
    check('assignments_status_check', sql`${table.status} in ('draft', 'published')`),
    check('assignments_window_check', sql`${table.openAt} < ${table.closeAt}`),
    check('assignments_max_attempts_check', sql`${table.maxAttempts} > 0`),
  ],
);

/**
 * Danh sách người thực tế nhận một bài giao tại thời điểm công bố, thay vì chỉ tra thành viên lớp mỗi lần làm bài.
 * Khóa chính ghép giữ một bản ghi cho mỗi người trong mỗi bài giao; không tự thêm người gia nhập lớp sau khi công bố.
 */
export const assignmentRecipients = pgTable(
  'assignment_recipients',
  {
    /**
     * Bài giao chứa danh sách người nhận; khóa ngoại hạn chế xóa bài giao còn có bản ghi người nhận.
     */
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    /**
     * Người học được nhận bài; cùng mã bài giao tạo thành khóa chính ghép.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Tình trạng quyền nhận bài: còn hiệu lực (active) hoặc đã thu hồi (revoked).
     */
    status: text('status').notNull().default('active'),
    /**
     * Nguồn lựa chọn người nhận: cả lớp (all_class) hoặc chỉ định (selected_users), để truy vết cách phân phối.
     */
    source: text('source').notNull(),
    /**
     * Thời điểm người học được ghi nhận là người nhận bài.
     */
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    /**
     * Thời điểm thu hồi quyền nhận bài; bắt buộc có khi trạng thái đã thu hồi, và phải trống khi còn hiệu lực.
     */
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    primaryKey({ columns: [table.assignmentId, table.userId] }),
    index('assignment_recipients_user_idx').on(table.userId),
    check('assignment_recipients_status_check', sql`${table.status} in ('active', 'revoked')`),
    check(
      'assignment_recipients_source_check',
      sql`${table.source} in ('all_class', 'selected_users')`,
    ),
    check(
      'assignment_recipients_revocation_check',
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
  ],
);
