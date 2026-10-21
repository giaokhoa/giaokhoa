import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { assignments, assignmentRecipients } from './assignments.js';

/**
 * Một lượt làm bài (attempt) của người học đối với một bài giao, bao gồm tiến độ, điểm và mốc nộp/chấm.
 * Khóa ngoại ghép đến danh sách người nhận bảo đảm người làm đã được phân phối bài; số lượt là duy nhất cho mỗi người trong bài giao.
 */
export const attempts = pgTable(
  'attempts',
  {
    /**
     * Mã lượt làm duy nhất, do PostgreSQL tạo UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Bài giao được thực hiện; không cho xóa bài giao đang có lịch sử làm bài.
     */
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    /**
     * Người học sở hữu lượt làm; kết hợp với mã bài giao phải xuất hiện trong danh sách người nhận.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Số thứ tự lượt làm của một người trong một bài giao, bắt đầu từ 1 và không trùng.
     */
    attemptNumber: integer('attempt_number').notNull(),
    /**
     * Trạng thái: đang làm (in_progress), đã nộp (submitted) hoặc đã chấm (graded); quy định các mốc thời gian bắt buộc tương ứng.
     */
    status: text('status').notNull().default('in_progress'),
    /**
     * Thời điểm bắt đầu lượt làm; tự đặt khi tạo bản ghi.
     */
    startedAt: timestamp('started_at').defaultNow().notNull(),
    /**
     * Thời điểm nộp bài; chỉ có từ trạng thái đã nộp trở đi.
     */
    submittedAt: timestamp('submitted_at'),
    /**
     * Thời điểm hoàn tất chấm bài; bắt buộc khi trạng thái đã chấm.
     */
    gradedAt: timestamp('graded_at'),
    /**
     * Điểm lưu dưới dạng số nguyên phần vạn, từ 0 đến 10000, để tránh sai số số thực.
     * Ví dụ giá trị 8750 tương ứng 87,50 điểm trên thang 100; chỉ có sau khi chấm.
     */
    scoreBasisPoints: integer('score_basis_points'),
    /**
     * Nhận xét chấm bài dành cho lượt làm; có thể để trống nếu chưa có hoặc không cần nhận xét.
     */
    feedback: text('feedback'),
  },
  (table) => [
    foreignKey({
      columns: [table.assignmentId, table.userId],
      foreignColumns: [assignmentRecipients.assignmentId, assignmentRecipients.userId],
      name: 'attempts_recipient_fk',
    }).onDelete('restrict'),
    unique('attempts_assignment_user_number_unique').on(
      table.assignmentId,
      table.userId,
      table.attemptNumber,
    ),
    index('attempts_assignment_idx').on(table.assignmentId),
    index('attempts_user_idx').on(table.userId),
    check('attempts_number_check', sql`${table.attemptNumber} > 0`),
    check('attempts_status_check', sql`${table.status} in ('in_progress', 'submitted', 'graded')`),
    check(
      'attempts_score_check',
      sql`${table.scoreBasisPoints} is null or ${table.scoreBasisPoints} between 0 and 10000`,
    ),
    check(
      'attempts_lifecycle_check',
      sql`
      (${table.status} = 'in_progress' and ${table.submittedAt} is null and ${table.gradedAt} is null and ${table.scoreBasisPoints} is null)
      or (${table.status} = 'submitted' and ${table.submittedAt} is not null and ${table.gradedAt} is null and ${table.scoreBasisPoints} is null)
      or (${table.status} = 'graded' and ${table.submittedAt} is not null and ${table.gradedAt} is not null and ${table.scoreBasisPoints} is not null)
    `,
    ),
  ],
);

/**
 * Lưu câu trả lời của từng vị trí câu hỏi trong một lượt làm bài.
 * Khóa chính ghép mã lượt làm và vị trí cho phép cập nhật đáp án ở một vị trí mà không tạo bản ghi trùng.
 */
export const attemptResponses = pgTable(
  'attempt_responses',
  {
    /**
     * Lượt làm bài sở hữu câu trả lời; quan hệ được giữ để không xóa nhầm lịch sử trả lời.
     */
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'restrict' }),
    /**
     * Vị trí câu hỏi trong đề đã giao, tính từ 1; kết hợp với lượt làm tạo khóa chính.
     */
    position: integer('position').notNull(),
    /**
     * Nội dung câu trả lời dạng JSON để hỗ trợ các loại câu hỏi có cấu trúc đáp án khác nhau.
     */
    answer: jsonb('answer').notNull(),
    /**
     * Thời điểm đáp án tại vị trí này được cập nhật gần nhất; hỗ trợ lưu tiến độ làm bài.
     */
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.position] }),
    check('attempt_responses_position_check', sql`${table.position} > 0`),
  ],
);
