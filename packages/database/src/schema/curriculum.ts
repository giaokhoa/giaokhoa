import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { questionBankEntries } from './questions.js';

/**
 * Danh mục môn học, là cấp gốc của chương trình và phân loại câu hỏi.
 * Mã đường dẫn cùng thứ tự hiển thị giúp nhận diện môn học ổn định và sắp xếp không phụ thuộc tên.
 */
export const subjects = pgTable(
  'subjects',
  {
    /**
     * Mã môn học duy nhất, được PostgreSQL tạo bằng UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Tên môn học hiển thị cho giáo viên và học sinh.
     */
    name: text('name').notNull(),
    /**
     * Mã thân thiện với đường dẫn (slug), duy nhất để tra cứu môn học mà không phụ thuộc tên hiển thị.
     */
    slug: text('slug').notNull().unique(),
    /**
     * Thứ tự môn học trong danh sách; bắt đầu từ 1, không cho phép giá trị bằng 0 hoặc âm.
     */
    position: integer('position').notNull().default(1),
  },
  (table) => [check('subjects_position_check', sql`${table.position} > 0`)],
);

/**
 * Chương trình học của một môn ở một khối lớp cụ thể.
 * Một môn chỉ có tối đa một chương trình cho mỗi khối từ 1 đến 12; các mục nội dung nằm trong chương trình này.
 */
export const curricula = pgTable(
  'curricula',
  {
    /**
     * Mã chương trình môn học duy nhất, sử dụng UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Môn học mà chương trình thuộc về; xóa môn sẽ xóa các chương trình con.
     */
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    /**
     * Khối lớp áp dụng, từ 1 đến 12; kết hợp với môn học để xác định duy nhất một chương trình.
     */
    grade: smallint('grade').notNull(),
  },
  (table) => [
    check('curricula_grade_check', sql`${table.grade} between 1 and 12`),
    unique('curricula_subject_id_grade_unique').on(table.subjectId, table.grade),
  ],
);

/**
 * Một mục trong cây nội dung của chương trình học, chẳng hạn chủ đề hoặc bài học.
 * Khóa ngoại ghép chương trình và nút cha bảo đảm nút con không thể trỏ sang chương trình khác.
 */
export const curriculumNodes = pgTable(
  'curriculum_nodes',
  {
    /**
     * Mã nút nội dung, được PostgreSQL cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Chương trình chứa nút; xóa chương trình sẽ xóa các nút nội dung của chương trình đó.
     */
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
    /**
     * Nút cha trong cùng chương trình; để trống đối với nút gốc. Ràng buộc ngăn nút tự làm cha chính mình.
     */
    parentId: uuid('parent_id'),
    /**
     * Tiêu đề của mục nội dung, được hiển thị trong cây chương trình.
     */
    title: text('title').notNull(),
    /**
     * Thứ tự mục giữa các nút cùng cấp; phải lớn hơn 0 để hỗ trợ sắp xếp rõ ràng.
     */
    position: integer('position').notNull().default(1),
  },
  (table) => [
    unique('curriculum_nodes_curriculum_id_id_unique').on(table.curriculumId, table.id),
    foreignKey({
      name: 'curriculum_nodes_parent_fk',
      columns: [table.curriculumId, table.parentId],
      foreignColumns: [table.curriculumId, table.id],
    }).onDelete('cascade'),
    check(
      'curriculum_nodes_parent_not_self_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    check('curriculum_nodes_position_check', sql`${table.position} > 0`),
    index('curriculum_nodes_tree_idx').on(table.curriculumId, table.parentId, table.position),
  ],
);

/**
 * Lưu yêu cầu cần đạt (learning outcome) gắn với từng mục nội dung của chương trình.
 * Mỗi mục nội dung có thể có nhiều yêu cầu; thứ tự hỗ trợ trình bày theo chương trình học.
 */
export const learningOutcomes = pgTable(
  'learning_outcomes',
  {
    /**
     * Mã yêu cầu cần đạt duy nhất, được cấp UUIDv7.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Nút nội dung chứa yêu cầu; yêu cầu bị xóa cùng nút khi nút không còn tồn tại.
     */
    nodeId: uuid('node_id')
      .notNull()
      .references(() => curriculumNodes.id, { onDelete: 'cascade' }),
    /**
     * Mô tả cụ thể kiến thức hoặc năng lực người học cần đạt.
     */
    content: text('content').notNull(),
    /**
     * Thứ tự yêu cầu trong một nút nội dung, bắt đầu từ 1.
     */
    position: integer('position').notNull().default(1),
  },
  (table) => [
    check('learning_outcomes_position_check', sql`${table.position} > 0`),
    index('learning_outcomes_node_id_idx').on(table.nodeId, table.position),
  ],
);

/**
 * Liên kết nhiều-nhiều giữa danh tính câu hỏi và môn học để phân loại ngân hàng câu hỏi.
 * Dùng khóa chính ghép hai mã để không lưu lặp cùng một liên kết; gắn với danh tính câu hỏi thay vì từng phiên bản.
 */
export const questionSubjects = pgTable(
  'question_subjects',
  {
    /**
     * Câu hỏi trong ngân hàng được phân loại; xóa câu hỏi sẽ xóa liên kết môn học.
     */
    questionBankEntryId: uuid('question_bank_entry_id')
      .notNull()
      .references(() => questionBankEntries.id, { onDelete: 'cascade' }),
    /**
     * Môn học gắn với câu hỏi; xóa môn học sẽ xóa liên kết phân loại này.
     */
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.questionBankEntryId, table.subjectId] }),
    index('question_subjects_subject_id_idx').on(table.subjectId),
  ],
);

/**
 * Liên kết nhiều-nhiều giữa câu hỏi và yêu cầu cần đạt để phục vụ tra cứu câu hỏi theo chương trình.
 * Gắn ở cấp danh tính câu hỏi; khóa chính ghép bảo đảm mỗi cặp câu hỏi và yêu cầu chỉ xuất hiện một lần.
 */
export const questionLearningOutcomes = pgTable(
  'question_learning_outcomes',
  {
    /**
     * Danh tính câu hỏi đáp ứng yêu cầu cần đạt; liên kết bị xóa khi câu hỏi gốc bị xóa.
     */
    questionBankEntryId: uuid('question_bank_entry_id')
      .notNull()
      .references(() => questionBankEntries.id, { onDelete: 'cascade' }),
    /**
     * Yêu cầu cần đạt được câu hỏi đánh giá; liên kết bị xóa khi yêu cầu không còn.
     */
    learningOutcomeId: uuid('learning_outcome_id')
      .notNull()
      .references(() => learningOutcomes.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.questionBankEntryId, table.learningOutcomeId] }),
    index('question_learning_outcomes_learning_outcome_id_idx').on(table.learningOutcomeId),
  ],
);
