import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { questionVersions } from './questions.js';

/**
 * Danh tính lâu dài của một đề thi (exam), không bị thay thế mỗi khi chỉnh sửa đề.
 * Các bản sửa đổi được lưu trong exam_revisions để bài giao cũ tiếp tục tham chiếu phiên bản đã chốt.
 */
export const exams = pgTable(
  'exams',
  {
    /**
     * Mã đề thi gốc duy nhất, được PostgreSQL cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Tiêu đề hiện tại của đề thi; ràng buộc ngăn tiêu đề chỉ chứa khoảng trắng.
     */
    title: text('title').notNull(),
    /**
     * Người tạo và sở hữu đề thi, dùng để kiểm tra quyền truy cập.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Thời điểm tạo danh tính đề thi.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /**
     * Thời điểm gần nhất thông tin đề thi gốc được cập nhật.
     */
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('exams_created_by_idx').on(table.createdByUserId),
    check('exams_title_check', sql`length(trim(${table.title})) > 0`),
  ],
);

/**
 * Một bản sửa đổi (revision) của đề thi với số lần sửa đổi và tiêu đề được giữ riêng.
 * Bài giao trỏ đến bản sửa đổi cụ thể; cặp mã đề và số sửa đổi phải duy nhất để tránh ghi đè lịch sử.
 */
export const examRevisions = pgTable(
  'exam_revisions',
  {
    /**
     * Mã bản sửa đổi đề thi duy nhất, được tạo bằng UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Đề thi gốc mà bản sửa đổi thuộc về; hạn chế xóa đề còn bản sửa đổi.
     */
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'restrict' }),
    /**
     * Số thứ tự lần sửa đổi của đề, bắt đầu từ 1 và không trùng trong cùng đề.
     */
    revision: integer('revision').notNull(),
    /**
     * Tiêu đề tại thời điểm tạo bản sửa đổi; lưu riêng để không bị ảnh hưởng khi đổi tên đề gốc.
     */
    title: text('title').notNull(),
    /**
     * Thời điểm bản sửa đổi được tạo và chốt nội dung.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('exam_revisions_exam_revision_unique').on(table.examId, table.revision),
    index('exam_revisions_exam_idx').on(table.examId),
    check('exam_revisions_revision_check', sql`${table.revision} > 0`),
  ],
);

/**
 * Danh sách câu hỏi theo thứ tự trong một bản sửa đổi đề thi, kèm bản chụp (snapshot) nội dung.
 * Giữ bản chụp để việc sửa câu hỏi trong ngân hàng về sau không làm thay đổi đề đã công bố.
 */
export const examRevisionQuestions = pgTable(
  'exam_revision_questions',
  {
    /**
     * Bản sửa đổi đề thi chứa câu hỏi; không cho xóa khi còn cấu trúc đề phụ thuộc.
     */
    examRevisionId: uuid('exam_revision_id')
      .notNull()
      .references(() => examRevisions.id, { onDelete: 'restrict' }),
    /**
     * Phiên bản câu hỏi đã được chọn từ ngân hàng; cùng phiên bản không được xuất hiện hai lần trong một bản sửa đổi đề.
     */
    questionVersionId: uuid('question_version_id')
      .notNull()
      .references(() => questionVersions.id, { onDelete: 'restrict' }),
    /**
     * Vị trí câu hỏi trong đề, bắt đầu từ 1 và duy nhất trong từng bản sửa đổi.
     */
    position: integer('position').notNull(),
    /**
     * Bản chụp JSON đầy đủ của câu hỏi tại lúc chốt đề; nguồn cố định cho các lần hiển thị và làm bài về sau.
     */
    questionSnapshot: jsonb('question_snapshot').notNull(),
    /** Ngữ liệu cố định đi kèm câu hỏi, không đọc lại nội dung đang được soạn thảo. */
    stimulusSnapshot: jsonb('stimulus_snapshot'),
  },
  (table) => [
    unique('exam_revision_questions_position_unique').on(table.examRevisionId, table.position),
    unique('exam_revision_questions_version_unique').on(
      table.examRevisionId,
      table.questionVersionId,
    ),
    index('exam_revision_questions_version_idx').on(table.questionVersionId),
    check('exam_revision_questions_position_check', sql`${table.position} > 0`),
  ],
);
