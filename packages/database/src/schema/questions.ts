import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';

/**
 * Lưu ngữ liệu (stimulus) có thể được nhiều câu hỏi độc lập cùng tham chiếu.
 * Tách ngữ liệu khỏi nội dung câu hỏi để chỉnh sửa và kiểm soát quyền sở hữu riêng; không coi câu hỏi là con của ngữ liệu.
 */
export const stimuli = pgTable('stimuli', {
  /**
   * Mã ngữ liệu duy nhất; PostgreSQL tự tạo UUIDv7 để các bản ghi được nhận diện ổn định.
   */
  id: uuid('id')
    .default(sql`uuidv7()`)
    .primaryKey(),
  /**
   * Người tạo và sở hữu ngữ liệu, tham chiếu đến tài khoản người dùng.
   * Cho phép để trống đối với bản ghi cũ chưa xác định được chủ; tầng nghiệp vụ phải từ chối truy cập khi không chứng minh được quyền sở hữu.
   */
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  /**
   * Nội dung ngữ liệu dưới dạng tài liệu có cấu trúc JSON; tầng hợp đồng kiểm tra định dạng trước khi lưu.
   */
  content: jsonb('content').notNull(),
});

/**
 * Đại diện cho danh tính lâu dài của một câu hỏi trong ngân hàng câu hỏi (question bank).
 * Giữ nguyên bản ghi này khi chỉnh sửa nội dung; mỗi lần sửa nội dung tạo phiên bản liên kết qua question_versions.
 */
export const questionBankEntries = pgTable(
  'question_bank_entries',
  {
    /**
     * Mã danh tính câu hỏi ổn định qua mọi phiên bản; PostgreSQL tự cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Tài khoản sở hữu câu hỏi; dùng để cô lập ngân hàng câu hỏi của các tác giả và kiểm tra quyền truy cập.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
  },
  (table) => [index('question_bank_entries_created_by_user_id_idx').on(table.createdByUserId)],
);

/**
 * Lưu nội dung của đúng một phiên bản câu hỏi, tách khỏi danh tính lâu dài trong ngân hàng câu hỏi.
 * Nội dung và đáp án không bị sửa trực tiếp khi tạo phiên bản mới; bảng question_versions xác định số phiên bản và trạng thái.
 */
export const question = pgTable(
  'question',
  {
    /**
     * Mã bản ghi nội dung câu hỏi; mỗi phiên bản được cấp UUIDv7 riêng.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Người sở hữu bản nội dung; phục vụ kiểm soát quyền khi truy xuất câu hỏi và ngữ liệu.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Mã ngữ liệu dùng chung nếu câu hỏi cần đoạn văn hoặc dữ kiện chung; để trống khi câu hỏi độc lập.
     */
    stimulusId: uuid('stimulus_id').references(() => stimuli.id),
    /**
     * Loại câu hỏi: trắc nghiệm một đáp án, đúng/sai, trả lời ngắn hoặc tự luận; ràng buộc SQL chặn giá trị ngoài bốn loại.
     */
    type: text('type').notNull(),
    /**
     * Nội dung hiển thị của câu hỏi dưới dạng tài liệu JSON của trình soạn thảo Tiptap; tách riêng khỏi đáp án.
     */
    content: jsonb('content').notNull(),
    /**
     * Hướng dẫn làm bài ở dạng tài liệu JSON; có thể để trống khi câu hỏi không cần hướng dẫn.
     */
    guidance: jsonb('guidance'),
    /**
     * Đáp án hoặc lời giải ở dạng JSON; có thể để trống đối với bản nháp, nhưng phải hợp lệ khi công bố trạng thái sẵn sàng.
     */
    solution: jsonb('solution'),
  },
  (table) => [
    check(
      'question_type_check',
      sql`${table.type} in ('multiple_choice', 'true_false', 'short_answer', 'essay')`,
    ),
    index('question_created_by_user_id_idx').on(table.createdByUserId),
    index('question_stimulus_id_idx').on(table.stimulusId),
  ],
);

/**
 * Gắn mỗi bản nội dung vào một câu hỏi trong ngân hàng cùng số phiên bản và trạng thái sử dụng.
 * Khóa duy nhất theo câu hỏi và số phiên bản ngăn trùng phiên bản; mỗi bản nội dung chỉ thuộc một liên kết phiên bản.
 */
export const questionVersions = pgTable(
  'question_versions',
  {
    /**
     * Mã liên kết phiên bản, được PostgreSQL tự cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Danh tính câu hỏi gốc; xóa câu hỏi gốc sẽ xóa các liên kết phiên bản đi kèm.
     */
    questionBankEntryId: uuid('question_bank_entry_id')
      .notNull()
      .references(() => questionBankEntries.id, { onDelete: 'cascade' }),
    /**
     * Bản nội dung cụ thể của phiên bản; quan hệ duy nhất ngăn dùng một bản nội dung làm nhiều phiên bản.
     */
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    /**
     * Số thứ tự phiên bản bắt đầu từ 1; duy nhất trong phạm vi một câu hỏi gốc.
     */
    version: integer('version').notNull(),
    /**
     * Trạng thái bản nội dung: bản nháp (draft) hoặc sẵn sàng sử dụng (ready); đổi trạng thái không nhất thiết tạo nội dung mới.
     */
    status: text('status').notNull(),
  },
  (table) => [
    check('question_versions_version_check', sql`${table.version} > 0`),
    check('question_versions_status_check', sql`${table.status} in ('draft', 'ready')`),
    unique('question_versions_entry_version_unique').on(table.questionBankEntryId, table.version),
    unique('question_versions_question_unique').on(table.questionId),
    index('question_versions_entry_id_idx').on(table.questionBankEntryId),
  ],
);
