import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { authzContexts } from './authorization.js';

/**
 * Quản lý đối tượng dữ liệu nhị phân dùng chung theo mã băm SHA-256 của nội dung.
 * Nhiều tệp có thể trỏ đến cùng đối tượng nếu byte giống hệt nhau; tách bảng giúp tránh lưu trùng dữ liệu trong kho lưu trữ đối tượng (object storage).
 */
export const fileBlobs = pgTable(
  'file_blobs',
  {
    /**
     * Mã băm SHA-256 của nội dung tệp, gồm 64 ký tự hệ thập lục phân viết thường; là khóa chính để nhận diện các byte giống nhau.
     */
    contentHash: text('content_hash').primaryKey(),
    /**
     * Đường dẫn đối tượng trong kho lưu trữ S3; duy nhất để không trỏ nhầm hai đối tượng vào cùng một khóa.
     */
    storageKey: text('storage_key').notNull().unique(),
    /**
     * Kích thước nội dung theo byte; không được âm và dùng để đối chiếu dữ liệu lưu trữ.
     */
    byteSize: integer('byte_size').notNull(),
    /**
     * Thời điểm hệ thống ghi nhận đối tượng dữ liệu nhị phân đầu tiên.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check('file_blobs_content_hash_check', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('file_blobs_byte_size_check', sql`${table.byteSize} >= 0`),
  ],
);

/**
 * Bản ghi tệp có chủ sở hữu, tên gốc và thông tin ảnh, tham chiếu đến một đối tượng dữ liệu theo mã băm.
 * Tách tệp khỏi nội dung nhị phân để có thể dùng chung byte, tạo biến thể ảnh và theo dõi tệp chưa được gắn vào nội dung.
 */
export const files = pgTable(
  'files',
  {
    /**
     * Mã tệp duy nhất, được PostgreSQL tự cấp UUIDv7; dùng làm tham chiếu từ câu hỏi và ngữ liệu.
     */
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Tài khoản tải hoặc tạo tệp, dùng để quyết định quyền đọc nguồn và quyền xóa.
     */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Mã băm nội dung trỏ đến file_blobs, cho phép nhiều bản ghi tệp chia sẻ một đối tượng dữ liệu.
     */
    contentHash: text('content_hash')
      .notNull()
      .references(() => fileBlobs.contentHash),
    /**
     * Loại nội dung truyền tải (MIME), chẳng hạn image/png, để trả tệp với kiểu dữ liệu phù hợp.
     */
    mimeType: text('mime_type').notNull(),
    /**
     * Chiều rộng ảnh tính bằng điểm ảnh; phải lớn hơn 0.
     */
    width: integer('width').notNull(),
    /**
     * Chiều cao ảnh tính bằng điểm ảnh; phải lớn hơn 0.
     */
    height: integer('height').notNull(),
    /**
     * Tên tệp ban đầu do người dùng cung cấp; lưu để hiển thị, không dùng làm đường dẫn lưu trữ.
     */
    originalFilename: text('original_filename').notNull(),
    /**
     * Mã tệp gốc nếu đây là biến thể như ảnh cắt; để trống với tệp gốc và không được trỏ chính mình.
     */
    parentFileId: uuid('parent_file_id').references((): AnyPgColumn => files.id),
    /**
     * Thời điểm tệp bắt đầu được coi là chưa có nội dung tham chiếu, dùng để xét thời hạn thu gom.
     * Mặc định ghi lúc tạo tệp; đặt trống khi tệp đã được gắn vào nội dung để tránh xóa nhầm tệp đang dùng.
     */
    orphanedAt: timestamp('orphaned_at').defaultNow(),
    /**
     * Thời điểm tạo bản ghi tệp, độc lập với thời điểm đối tượng nhị phân được lưu lần đầu.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check('files_dimensions_check', sql`${table.width} > 0 and ${table.height} > 0`),
    check(
      'files_parent_not_self_check',
      sql`${table.parentFileId} is null or ${table.parentFileId} <> ${table.id}`,
    ),
    index('files_created_by_user_id_idx').on(table.createdByUserId),
    index('files_content_hash_idx').on(table.contentHash),
    index('files_parent_file_id_idx').on(table.parentFileId),
    index('files_orphaned_at_idx').on(table.orphanedAt),
  ],
);

/**
 * Ghi lại từng vị trí sử dụng tệp trong nội dung và phạm vi phân quyền, theo mô hình vị trí tệp (file area).
 * Một tệp có thể xuất hiện ở nhiều câu hỏi hoặc ngữ liệu; khóa duy nhất nhiều cột ngăn ghi trùng cùng vị trí.
 */
export const fileUses = pgTable(
  'file_uses',
  {
    /**
     * Tệp đang được tham chiếu; xóa tệp sẽ xóa luôn các bản ghi vị trí sử dụng liên quan.
     */
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    /**
     * Phạm vi phân quyền (authorization context) mà việc sử dụng tệp thuộc về; phục vụ quyết định quyền xem.
     */
    contextId: uuid('context_id')
      .notNull()
      .references(() => authzContexts.id),
    /**
     * Phân hệ sở hữu tham chiếu, ví dụ câu hỏi (questions), ngữ liệu (stimuli) hoặc người dùng (user).
     */
    component: text('component').notNull(),
    /**
     * Vùng nội dung chứa tệp, ví dụ nội dung chính (content), hướng dẫn (guidance), lời giải (solution) hay nháp (draft).
     */
    fileArea: text('file_area').notNull(),
    /**
     * Mã đối tượng cụ thể trong phân hệ, lưu dạng văn bản để tham chiếu nhiều loại đối tượng mà không thêm cột cho mỗi loại.
     */
    itemId: text('item_id').notNull(),
    /**
     * Thời điểm tệp được liên kết với vị trí sử dụng này.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('file_uses_identity_unique').on(
      table.fileId,
      table.contextId,
      table.component,
      table.fileArea,
      table.itemId,
    ),
    index('file_uses_file_id_idx').on(table.fileId),
    index('file_uses_context_idx').on(table.contextId),
    check('file_uses_component_check', sql`length(trim(${table.component})) > 0`),
    check('file_uses_file_area_check', sql`length(trim(${table.fileArea})) > 0`),
    check('file_uses_item_id_check', sql`length(trim(${table.itemId})) > 0`),
  ],
);

/**
 * Lưu mã nguồn để tái tạo tệp sinh từ TikZ mà không phát hành mã nguồn cùng nội dung ảnh nhị phân.
 * Quan hệ một-một với bản ghi tệp để mã nguồn chỉ tồn tại khi có tệp tương ứng và bị xóa khi tệp mất.
 */
export const fileSources = pgTable(
  'file_sources',
  {
    /**
     * Mã tệp được tạo từ nguồn; đồng thời là khóa chính để mỗi tệp chỉ có một bản mã nguồn.
     */
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    /**
     * Kiểu nguồn tạo tệp; hiện chỉ hỗ trợ mã vẽ TikZ và bị ràng buộc ở tầng cơ sở dữ liệu.
     */
    kind: text('kind').notNull(),
    /**
     * Nội dung mã TikZ dùng để tạo hoặc chỉnh sửa lại hình ảnh; quyền truy cập phải được kiểm tra riêng.
     */
    source: text('source').notNull(),
    /**
     * Thời điểm mã nguồn tạo tệp được lưu.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [check('file_sources_kind_check', sql`${table.kind} = 'tikz'`)],
);

/**
 * Hàng đợi xóa đối tượng (outbox) trong PostgreSQL, dùng khi thông tin mô tả tệp (metadata) và đối tượng S3 không thể xóa trong cùng một giao dịch.
 * Lưu khóa cần xóa trước, sau đó tác vụ thu gom xử lý; nếu S3 lỗi, bản ghi còn lại để thử lại an toàn.
 */
export const fileObjectDeletions = pgTable('file_object_deletions', {
  /**
   * Đường dẫn đối tượng cần xóa khỏi kho lưu trữ; làm khóa chính để không có hai yêu cầu xóa trùng nhau.
   */
  storageKey: text('storage_key').primaryKey(),
  /**
   * Thời điểm ghi nhận yêu cầu xóa hoặc dự phòng một đối tượng vừa tải lên.
   */
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /**
   * Thời điểm sớm nhất được phép thực hiện xóa; tác vụ thu gom chỉ lấy bản ghi đã đến hạn.
   * Cho phép trì hoãn xóa bản tải lên đang chờ lưu thông tin mô tả tệp và chuyển sang xóa ngay khi đã xác định là đối tượng thừa.
   */
  availableAt: timestamp('available_at').defaultNow().notNull(),
});
