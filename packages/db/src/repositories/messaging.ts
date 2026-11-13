import { sql, type InsertObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { MessagingConversationsRepository } from './messaging-conversations';
import { MessagingContactsRepository } from './messaging-contacts';
import { MessagingEnrolmentRepository } from './messaging-enrolment';
import { MessagingSyncRepository } from './messaging-sync';
import { MessagingTreeRepository } from './messaging-tree';
import { MessagingNotificationsRepository } from './messaging-notifications';


/**
 * Kho dữ liệu nhắn tin và thông báo trên Kysely: quản lý hội thoại, thành viên, tin nhắn, chặn liên lạc, thông báo và nhật ký phân phối; cung cấp các phép đọc context, vai trò, ghi danh và lớp/khoá mà nghiệp vụ nhắn tin cần.
 *
 * Từ đợt rà soát code style issue #50, class này là FACADE mỏng: phần cài đặt theo miền nằm ở sáu file anh em (`messaging-conversations.ts`, `messaging-contacts.ts`, `messaging-enrolment.ts`, `messaging-sync.ts`, `messaging-tree.ts`, `messaging-notifications.ts`) — mỗi file một class miền, facade giữ nguyên tên class export và API public rồi uỷ quyền sang đó. Kiểu dòng, hằng, danh sách cột và hàm ánh xạ dùng chung vẫn khai ở file này để các miền import từ một chỗ.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Cột đọc khai tường minh kèm bí danh camelCase dùng chung cho
 *   select và returning — KHÔNG bật CamelCasePlugin.
 * - Kiểu dòng công khai khai tường minh bằng camelCase để biên API không phụ thuộc lược đồ cột snake_case.
 * - Ghi qua hàm ánh xạ Insert loại `undefined` tường minh từng
 *   trường (thử nghiệm T-4).
 * - Khoá chính `uuidv7()` do database sinh (phụ lục U): insert bỏ
 *   qua `id` khi phía gọi không cấp và lấy id qua `returning`.
 * - `count(*)` ép `::int` tường minh để giữ kiểu `number` của hợp
 *   đồng cũ (T-7).
 * - Điều kiện động dựng theo mẫu T-13: mọi điều kiện đều là biểu
 *   thức có giá trị bắt buộc, hợp bằng `eb.and(conds)`; KHÔNG bao
 *   giờ truyền `undefined` vào `where`.
 * - Ba điểm ghép đoạn động bằng `sql.join` của bản cũ (danh sách
 *   IN, WHERE, HAVING của `listNotificationGroups`) viết lại bằng
 *   `sql.join` của Kysely theo khuôn T-11, có spec riêng ở
 *   `messaging.spec.ts` (tầng biên dịch) và
 *   `messaging.int-spec.ts` (kết quả thật).
 *
 * GỠ VÒNG PHỤ THUỘC `@giaokhoa/db` ↔ `@giaokhoa/messaging`: bề mặt đọc dùng
 * chung của messaging (luật đọc tin/hội thoại cho cả đường REST
 * phía API và consumer phân phối phía worker) vẫn cài đặt tại
 * `@giaokhoa/messaging` dưới dạng hàm thuần nhận handle Kysely. File
 * này KHAI cổng {@link MessagingStorePort} cho đúng bề mặt đó;
 * repository nhận cài đặt của cổng qua constructor và uỷ quyền
 * mọi phép đọc dùng chung qua cổng — `@giaokhoa/db` không import
 * `@giaokhoa/messaging` ở bất kỳ dạng nào, còn `@giaokhoa/messaging` chỉ
 * import type-only từ file này (kiểu dòng + cổng), nên đồ thị
 * phụ thuộc là DAG. Các helper thuần chuỗi của họ excerpt
 * (`quoteExcerptOf`, `searchExcerptOf`) ở lại `@giaokhoa/messaging`
 * vì chúng là logic hình dạng wire, không phải truy cập dữ liệu.
 *
 * RANH GIỚI NGỮ CẢNH: repository này KHÔNG đọc ALS hay bất kỳ
 * ngữ cảnh app nào. Chín method của cụm notification nhận tham
 * số `tenantId` tường minh do tầng service phía app truyền
 * xuống (service đọc ngữ cảnh tenant của request hiện hành) —
 * đúng luật của issue: đổi chỗ đọc ALS trong repository thành
 * tham số tường minh, giữ nguyên ngữ nghĩa lọc (có tenant thì
 * lọc theo tenant đó, không có thì không lọc thêm ở tầng này;
 * RLS fail-closed là lưới cứng phía sau).
 *
 * Mọi truy vấn thuần dữ liệu; quy tắc nghiệp vụ nằm ở tầng
 * service phía ứng dụng.
 */

/** Handle kho trung tâm mà repository chấp nhận: thường hoặc trong giao dịch. */
export type MessagingDb = CentreDb | CentreTx;
/** Handle giao dịch kho trung tâm. */
export type MessagingTx = CentreTx;

// Kiểu dòng công khai: tên thuộc tính camelCase ánh xạ từ cột PostgreSQL.

/** Dòng `message_conversations`. */
export interface ConversationRow {
  id: string;
  type: number;
  name: string | null;
  component: string | null;
  itemType: string | null;
  itemId: string | null;
  contextId: string | null;
  enabled: boolean;
  createdBy: string | null;
  tenantId: string | null;
  lastMessageSeq: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `message`. */
export interface MessageRow {
  id: string;
  conversationId: string;
  userIdFrom: string;
  subject: string;
  fullMessage: string;
  smallMessage: string;
  seq: number;
  clientMessageId: string | null;
  replyToMessageId: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  recalledAt: Date | null;
  recalledBy: string | null;
  createdAt: Date;
}

/** Dòng `notifications`. */
export interface NotificationRow {
  id: string;
  userIdFrom: string | null;
  userIdTo: string;
  tenantId: string | null;
  subject: string;
  fullMessage: string;
  smallMessage: string;
  component: string;
  eventType: string;
  contextUrl: string | null;
  contextUrlName: string | null;
  createdAt: Date;
  timeRead: Date | null;
}

/** Dòng `notification_dispatch_log`. */
export interface DispatchLogRow {
  id: string;
  notificationId: string | null;
  userId: string;
  tenantId: string | null;
  provider: string;
  channel: string;
  status: string;
  subject: string;
  dedupeKey: string | null;
  createdAt: Date;
}

/** Dòng `message_contacts`. */
export interface ContactRow {
  userId: string;
  contactId: string;
  createdAt: Date;
}

/** Dòng `message_contact_requests`. */
export interface ContactRequestRow {
  userIdFrom: string;
  userIdTo: string;
  createdAt: Date;
}

/** Dòng `message_conversation_reports`. */
export interface ReportRow {
  id: string;
  conversationId: string;
  reporterId: string;
  reason: string;
  status: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Dòng `message_moderator_actions`. */
export interface ModeratorActionRow {
  id: string;
  messageId: string;
  conversationId: string;
  actorId: string;
  authorId: string;
  action: string;
  reason: string | null;
  messageSeq: number | null;
  createdAt: Date;
}

/** Dòng `course_groups`. */
export interface CourseGroupRow {
  id: string;
  courseId: string;
  name: string;
  idNumber: string;
  description: string;
  enrolmentKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Một dòng của danh sách conversation cho một user: conversation + mốc đã đọc của CHÍNH user đó + số chưa đọc tính từ mốc + tin cuối. Lấy bằng MỘT truy vấn (join + lateral) — thay mô hình cũ tải toàn bộ tin của mọi conversation về đếm ở tầng JS.
 */
export interface ConversationSummaryRow {
  conversation: ConversationRow;
  members: string[];
  lastReadSeq: number;
  unreadCount: number;
  lastMessage: MessageRow | null;
  /** Trạng thái cá nhân của chính user trên conversation này (lát M5): mốc ghim (null = không ghim). */
  pinnedAt: Date | null;
  /** Trạng thái cá nhân (lát M5): mốc lưu trữ (null = không lưu). */
  archivedAt: Date | null;
  /** Trạng thái cá nhân (lát M5): đã tắt tiếng conversation này hay chưa. */
  muted: boolean;
}

/**
 * Dòng thô của truy vấn SQL trong `listConversationSummaries` (S9): hình
 * dạng đúng các cột SELECT đặt bí danh ở truy vấn đó, để ánh xạ sang
 * `ConversationSummaryRow` đọc trường đã gõ kiểu thay vì `Record<string,
 * unknown>` + ép `as` từng trường. Mốc thời gian ở đây là `Date` (driver
 * `pg` trả timestamptz thành `Date`); riêng `last_message` là `to_jsonb`
 * nên mốc thời gian bên trong nó là chuỗi ISO (xem `LastMessageJsonRow`).
 */
export interface ConversationSummaryRawRow {
  conversation_id: string;
  conversation_type: number;
  conversation_name: string | null;
  conversation_component: string | null;
  conversation_item_type: string | null;
  conversation_item_id: string | null;
  conversation_context_id: string | null;
  conversation_enabled: boolean;
  conversation_created_by: string | null;
  conversation_tenant_id: string | null;
  conversation_last_seq: number;
  conversation_created_at: Date;
  conversation_updated_at: Date;
  last_read_seq: number;
  pinned_at: Date | null;
  archived_at: Date | null;
  muted: boolean;
  members: string[];
  unread_count: number;
  last_message: LastMessageJsonRow | null;
}

/**
 * Tin cuối dạng JSON (`to_jsonb(msg)`) trong `ConversationSummaryRawRow`:
 * các cột của bảng `message` với mốc thời gian đã serialize thành chuỗi
 * ISO bởi `to_jsonb`. Nullability khớp kiểu sinh của bảng `message`.
 */
export interface LastMessageJsonRow {
  id: string;
  conversation_id: string;
  user_id_from: string;
  subject: string;
  full_message: string;
  small_message: string;
  seq: number;
  client_message_id: string | null;
  reply_to_message_id: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  recalled_at: string | null;
  recalled_by: string | null;
  created_at: string;
}

/**
 * Dòng thô của truy vấn SQL trong `listClassRosterPage` (S9): hình dạng
 * đúng các cột SELECT của truy vấn đó. `staff`/`enrolled` có thể null
 * (`bool_or` trên tập toàn NULL khi archetype của vai là null — cột
 * `role.archetype` nullable) nên ánh xạ vẫn qua `Boolean(...)` như cũ.
 */
export interface ClassRosterRawRow {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  display_name: string;
  staff: boolean | null;
  enrolled: boolean | null;
}

/** Tuỳ chọn tìm nội dung tin trong một conversation (lát M4, issue #237). */
export interface MessageSearchOptions {
  /** Chuỗi con cần khớp (đã cắt khoảng trắng ở tầng service), khớp không phân biệt hoa thường. */
  query: string;
  /** Số kết quả tối đa (mặc định 20, trần 50) — kết quả mới nhất trước. */
  limit?: number;
  /**
   * Tầm nhìn truy vết của người có thẩm quyền kiểm duyệt: tìm cả trên tin đã xoá mềm/đã thu hồi và bỏ qua cờ xoá-phía-mình — đúng tầm nhìn của cửa sổ tin truy vết.
   */
  privileged?: boolean;
  /** Người đang tìm (chỉ áp khi không privileged): loại tin người này đã xoá-phía-mình. */
  viewerId?: string;
  /**
   * Tác giả bị loại khỏi kết quả của người thường: các phía có quan hệ chặn hai chiều với người tìm — luật "liên hệ đã chặn thì ẩn khỏi mọi bề mặt" áp cho cả kết quả tìm (hội thoại 1–1 đã bị cổng chặn chặn ở tầng service trước khi tới đây).
   */
  excludedAuthorIds?: string[];
}

/**
 * Một dòng GỘP thô của trung tâm thông báo v2 (issue #51) từ truy vấn tổng hợp: khoá gộp (loại × nguồn × ngày) + đếm + mốc của mục mới nhất làm neo phân trang keyset. `sourceKey` là `contextUrl` đã chuẩn hoá ('' khi thông báo không có ngữ cảnh đích); `day` là ngày lịch Asia/Ho_Chi_Minh dạng YYYY-MM-DD.
 */
export interface NotificationGroupAggregateRow {
  eventType: string;
  component: string;
  sourceKey: string;
  day: string;
  count: number;
  unreadCount: number;
  latestAt: Date;
  latestId: string;
}

/** Bộ lọc của danh sách thông báo phẳng v2 (mở chi tiết một dòng gộp hoặc lọc theo nhóm). */
export interface NotificationItemsOptions {
  /** Lọc đúng một loại sự kiện. */
  eventType?: string;
  /** Lọc theo tập loại của một nhóm (học tập / lớp & mọi người / hệ thống). */
  eventTypes?: string[];
  /** Nguồn: undefined = không lọc, null = chỉ mục không có contextUrl, chuỗi = contextUrl cụ thể. */
  source?: string | null;
  /** Ngày lịch Asia/Ho_Chi_Minh dạng YYYY-MM-DD. */
  day?: string;
  unreadOnly?: boolean;
  /** Neo keyset: chỉ lấy mục "cũ hơn" mốc (createdAt, id) này. */
  cursor?: { createdAt: Date; id: string };
  limit: number;
}

/** Tuỳ chọn cửa sổ tin theo cursor seq (bề mặt đọc dùng chung của `@giaokhoa/messaging`). */
export interface MessageWindowOptions {
  /** Chỉ lấy tin có seq nhỏ hơn mốc này (tải lịch sử cũ hơn). */
  beforeSeq?: number;
  /** Chỉ lấy tin có seq lớn hơn mốc này (đồng bộ phần thiếu). */
  afterSeq?: number;
  /** Số tin tối đa trong cửa sổ (mặc định 50, trần 100). */
  limit?: number;
  /**
   * Kèm cả tin đã xoá mềm (mặc định KHÔNG): chỉ các cửa sổ truy vết của người có thẩm quyền (giáo viên phụ trách/quản trị) mới bật — mọi đường đọc thường của thành viên luôn lọc bỏ tin đã xoá.
   */
  includeDeleted?: boolean;
  /**
   * Người đang xem (vòng đời tin nhắn theo vai): khi có mặt và KHÔNG ở chế độ truy vết (includeDeleted), cửa sổ lọc bỏ thêm các tin người này đã XOÁ-PHÍA-MÌNH (bảng `message_user_deletions`) — cờ cá nhân chỉ áp cho đúng chủ nhân của nó, không ai khác bị ảnh hưởng. Chế độ truy vết bỏ qua cờ này: dấu vết phải đầy đủ.
   */
  viewerId?: string;
}

/**
 * Khối tóm tắt TRÍCH DẪN của một tin gốc (lát M3, issue #229) — hình dạng khớp `messageQuoteSchema` của @giaokhoa/contracts (khai báo ở đây để tầng dữ liệu là nguồn định nghĩa duy nhất của hình dạng dòng; `@giaokhoa/messaging` re-export cho các phía tiêu thụ hiện hữu).
 */
export interface MessageQuoteView {
  id: string;
  seq: number;
  userIdFrom: string;
  excerpt: string;
  unavailable: boolean;
}

/** Một dòng tin kèm khối trích dẫn đã dựng sẵn cho người nhận (`replyTo = null` khi không trích dẫn). */
export type MessageWithQuoteRow = MessageRow & { replyTo: MessageQuoteView | null };

/**
 * Các archetype vai trò được coi là "staff" cho các cổng nghiệp vụ của Lớp B (tạo nhóm tự do, quản lý conversation): quản lý, người tạo khoá, giáo viên có/không quyền sửa. Học sinh (archetype student) và các vai trò mặc định (user/guest) KHÔNG nằm trong tập này.
 */
export const STAFF_ARCHETYPES = ['manager', 'coursecreator', 'editingteacher', 'teacher'] as const;

/**
 * Múi giờ trình bày ngày của thông báo (gộp theo ngày, lọc theo ngày):
 * ngày của người dùng Việt Nam, dùng chung cho cả bốn điểm SQL thô dưới
 * đây. Nhúng bằng `sql.raw` để chuỗi SQL gửi đi giữ nguyên literal
 * `'Asia/Ho_Chi_Minh'` (không thành tham số), tránh đổi hình dạng truy vấn.
 */
export const NOTIFICATION_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Biểu thức tên hiển thị của người dùng trong roster (S19): họ + tên đã cắt khoảng trắng, rỗng cả hai thì lùi về tên đăng nhập. Dùng chung cho cả hai trang roster (khoá/lớp): điều kiện con trỏ keyset và cột `display_name` đều phải dùng đúng một biểu thức này, không viết lại.
 */
export const USER_DISPLAY_NAME_EXPR = sql`case when btrim(u.first_name || ' ' || u.last_name) = '' then u.username else btrim(u.first_name || ' ' || u.last_name) end`;

// ---------------------------------------------------------------------------
// Cổng bề mặt đọc dùng chung (gỡ vòng @giaokhoa/db ↔ @giaokhoa/messaging)
// ---------------------------------------------------------------------------

/**
 * Cổng của tầng store đọc dùng chung: đúng 13 phép đọc mà repository uỷ quyền sang cài đặt tại `@giaokhoa/messaging` (hàm thuần nhận handle Kysely, xem `distribution-store.ts` của package đó). Phía app gắn cài đặt qua `createMessagingStore(handle)` khi dựng repository; phía worker tiêu thụ cùng các hàm thuần qua bề mặt phân phối hẹp hơn của nó. Repository KHÔNG tự import cài đặt — chiều phụ thuộc duy nhất là `@giaokhoa/messaging` → (type-only) file này.
 */
export interface MessagingStorePort {
  /** Lấy conversation theo id. */
  getConversationById(id: string): Promise<ConversationRow | undefined>;
  /** Thành viên của conversation. */
  listConversationMemberIds(conversationId: string): Promise<string[]>;
  /** Tenant của một conversation — nguồn tenant cho notification tin nhắn mới. */
  getConversationTenantId(conversationId: string): Promise<string | null>;
  /** Lấy tin nhắn theo id. */
  getMessageById(id: string): Promise<MessageRow | undefined>;
  /** Lấy nhiều dòng tin theo id (kiểm tra thẩm quyền hàng loạt trước khi gỡ). */
  getMessagesByIds(ids: string[]): Promise<MessageRow[]>;
  /** Trong tập id này, các tin user đã đặt cờ xoá-phía-mình. */
  listDeletedForUserIds(messageIds: string[], userId: string): Promise<Set<string>>;
  /** Gắn khối trích dẫn cho một lô tin theo quyền của người nhận. */
  attachQuotesToRows(rows: MessageRow[], opts: { privileged: boolean; viewerId?: string }): Promise<MessageWithQuoteRow[]>;
  /** Mốc đã đọc của một thành viên (undefined nếu không phải thành viên). */
  getMemberLastReadSeq(conversationId: string, userId: string): Promise<number | undefined>;
  /** Số tin chưa đọc của MỘT user trong MỘT conversation theo vũ trụ đếm chuẩn. */
  countUnreadForConversation(conversationId: string, userId: string): Promise<number>;
  /** Một cửa sổ tin của conversation theo cursor seq, luôn trả tăng dần theo seq. */
  listMessagesPage(conversationId: string, opts?: MessageWindowOptions): Promise<MessageRow[]>;
  /** Danh sách user bị chặn bởi user này. */
  listBlockedUserIds(userId: string): Promise<string[]>;
  /** Danh sách user ĐÃ CHẶN user này (chiều ngược). */
  listBlockerUserIds(userId: string): Promise<string[]>;
  /** Mọi user đang có quan hệ chặn với user này ở bất kỳ chiều nào. */
  listBlockedCounterpartIds(userId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Kiểu ghi vào (khớp `$inferInsert` của repository cũ)
// ---------------------------------------------------------------------------

/** Giá trị chèn `message_conversations` (id do database sinh bằng uuidv7 khi không cấp). */
export interface NewConversation {
  id?: string;
  type?: number;
  name?: string | null;
  component?: string | null;
  itemType?: string | null;
  itemId?: string | null;
  contextId?: string | null;
  enabled?: boolean;
  createdBy?: string | null;
  tenantId?: string | null;
  lastMessageSeq?: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Giá trị chèn `message` (id do database sinh bằng uuidv7 khi không cấp). */
export interface NewMessage {
  id?: string;
  conversationId: string;
  userIdFrom: string;
  subject?: string;
  fullMessage?: string;
  smallMessage?: string;
  seq: number;
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  deletedAt?: Date | string | null;
  deletedBy?: string | null;
  recalledAt?: Date | string | null;
  recalledBy?: string | null;
  createdAt?: Date | string;
}

/** Giá trị chèn `notifications` (id do database sinh bằng uuidv7 khi không cấp). */
export interface NewNotification {
  id?: string;
  userIdFrom?: string | null;
  userIdTo: string;
  tenantId?: string | null;
  subject?: string;
  fullMessage?: string;
  smallMessage?: string;
  component?: string;
  eventType?: string;
  contextUrl?: string | null;
  contextUrlName?: string | null;
  createdAt?: Date | string;
  timeRead?: Date | string | null;
}

/** Giá trị chèn `message_conversation_reports` (id do database sinh bằng uuidv7 khi không cấp). */
export interface NewReport {
  id?: string;
  conversationId: string;
  reporterId: string;
  reason?: string;
  status?: string;
  resolvedBy?: string | null;
  resolvedAt?: Date | string | null;
  createdAt?: Date | string;
}

/** Giá trị chèn `notification_dispatch_log` (id do database sinh bằng uuidv7 khi không cấp). */
export interface NewDispatchLog {
  id?: string;
  notificationId?: string | null;
  userId: string;
  tenantId?: string | null;
  provider: string;
  channel: string;
  status: string;
  subject?: string;
  dedupeKey?: string | null;
  createdAt?: Date | string;
}

/** Giá trị chèn một dòng dấu vết hành động kiểm duyệt (`message_moderator_actions`). */
export interface NewModeratorAction {
  messageId: string;
  conversationId: string;
  actorId: string;
  authorId: string;
  action: 'recall' | 'hard_delete' | 'bulk_hard_delete';
  reason?: string | null;
  messageSeq?: number | null;
}

// ---------------------------------------------------------------------------
// Danh sách cột đọc (dùng chung cho select và returning)
// ---------------------------------------------------------------------------

export const CONVERSATION_COLUMNS = [
  'id',
  'type',
  'name',
  'component',
  'item_type as itemType',
  'item_id as itemId',
  'context_id as contextId',
  'enabled',
  'created_by as createdBy',
  'tenant_id as tenantId',
  'last_message_seq as lastMessageSeq',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Như {@link CONVERSATION_COLUMNS} nhưng đủ tiền tố bảng — dùng ở truy vấn có join với bảng thành viên. */
export const CONVERSATION_COLUMNS_QUALIFIED = [
  'message_conversations.id as id',
  'message_conversations.type as type',
  'message_conversations.name as name',
  'message_conversations.component as component',
  'message_conversations.item_type as itemType',
  'message_conversations.item_id as itemId',
  'message_conversations.context_id as contextId',
  'message_conversations.enabled as enabled',
  'message_conversations.created_by as createdBy',
  'message_conversations.tenant_id as tenantId',
  'message_conversations.last_message_seq as lastMessageSeq',
  'message_conversations.created_at as createdAt',
  'message_conversations.updated_at as updatedAt',
] as const;

export const MESSAGE_COLUMNS = [
  'id',
  'conversation_id as conversationId',
  'user_id_from as userIdFrom',
  'subject',
  'full_message as fullMessage',
  'small_message as smallMessage',
  'seq',
  'client_message_id as clientMessageId',
  'reply_to_message_id as replyToMessageId',
  'deleted_at as deletedAt',
  'deleted_by as deletedBy',
  'recalled_at as recalledAt',
  'recalled_by as recalledBy',
  'created_at as createdAt',
] as const;

export const NOTIFICATION_COLUMNS = [
  'id',
  'user_id_from as userIdFrom',
  'user_id_to as userIdTo',
  'tenant_id as tenantId',
  'subject',
  'full_message as fullMessage',
  'small_message as smallMessage',
  'component',
  'event_type as eventType',
  'context_url as contextUrl',
  'context_url_name as contextUrlName',
  'created_at as createdAt',
  'time_read as timeRead',
] as const;

export const DISPATCH_LOG_COLUMNS = [
  'id',
  'notification_id as notificationId',
  'user_id as userId',
  'tenant_id as tenantId',
  'provider',
  'channel',
  'status',
  'subject',
  'dedupe_key as dedupeKey',
  'created_at as createdAt',
] as const;

export const CONTACT_REQUEST_COLUMNS = [
  'user_id_from as userIdFrom',
  'user_id_to as userIdTo',
  'created_at as createdAt',
] as const;

export const REPORT_COLUMNS = [
  'id',
  'conversation_id as conversationId',
  'reporter_id as reporterId',
  'reason',
  'status',
  'resolved_by as resolvedBy',
  'resolved_at as resolvedAt',
  'created_at as createdAt',
] as const;

export const MODERATOR_ACTION_COLUMNS = [
  'id',
  'message_id as messageId',
  'conversation_id as conversationId',
  'actor_id as actorId',
  'author_id as authorId',
  'action',
  'reason',
  'message_seq as messageSeq',
  'created_at as createdAt',
] as const;

export const COURSE_GROUP_COLUMNS = [
  'id',
  'course_id as courseId',
  'name',
  'id_number as idNumber',
  'description',
  'enrolment_key as enrolmentKey',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

// ---------------------------------------------------------------------------
// Ánh xạ ghi: loại `undefined` tường minh từng trường (T-4).
// ---------------------------------------------------------------------------

export function conversationInsertValues(values: NewConversation): InsertObject<CentreDB, 'message_conversations'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.type !== undefined ? { type: values.type } : {}),
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.component !== undefined ? { component: values.component } : {}),
    ...(values.itemType !== undefined ? { item_type: values.itemType } : {}),
    ...(values.itemId !== undefined ? { item_id: values.itemId } : {}),
    ...(values.contextId !== undefined ? { context_id: values.contextId } : {}),
    ...(values.enabled !== undefined ? { enabled: values.enabled } : {}),
    ...(values.createdBy !== undefined ? { created_by: values.createdBy } : {}),
    ...(values.tenantId !== undefined ? { tenant_id: values.tenantId } : {}),
    ...(values.lastMessageSeq !== undefined ? { last_message_seq: values.lastMessageSeq } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

export function messageInsertValues(values: NewMessage): InsertObject<CentreDB, 'message'> {
  return {
    conversation_id: values.conversationId,
    user_id_from: values.userIdFrom,
    seq: values.seq,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.subject !== undefined ? { subject: values.subject } : {}),
    ...(values.fullMessage !== undefined ? { full_message: values.fullMessage } : {}),
    ...(values.smallMessage !== undefined ? { small_message: values.smallMessage } : {}),
    ...(values.clientMessageId !== undefined ? { client_message_id: values.clientMessageId } : {}),
    ...(values.replyToMessageId !== undefined ? { reply_to_message_id: values.replyToMessageId } : {}),
    ...(values.deletedAt !== undefined ? { deleted_at: values.deletedAt } : {}),
    ...(values.deletedBy !== undefined ? { deleted_by: values.deletedBy } : {}),
    ...(values.recalledAt !== undefined ? { recalled_at: values.recalledAt } : {}),
    ...(values.recalledBy !== undefined ? { recalled_by: values.recalledBy } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

export function notificationInsertValues(values: NewNotification): InsertObject<CentreDB, 'notifications'> {
  return {
    user_id_to: values.userIdTo,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.userIdFrom !== undefined ? { user_id_from: values.userIdFrom } : {}),
    ...(values.tenantId !== undefined ? { tenant_id: values.tenantId } : {}),
    ...(values.subject !== undefined ? { subject: values.subject } : {}),
    ...(values.fullMessage !== undefined ? { full_message: values.fullMessage } : {}),
    ...(values.smallMessage !== undefined ? { small_message: values.smallMessage } : {}),
    ...(values.component !== undefined ? { component: values.component } : {}),
    ...(values.eventType !== undefined ? { event_type: values.eventType } : {}),
    ...(values.contextUrl !== undefined ? { context_url: values.contextUrl } : {}),
    ...(values.contextUrlName !== undefined ? { context_url_name: values.contextUrlName } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.timeRead !== undefined ? { time_read: values.timeRead } : {}),
  };
}

export function reportInsertValues(values: NewReport): InsertObject<CentreDB, 'message_conversation_reports'> {
  return {
    conversation_id: values.conversationId,
    reporter_id: values.reporterId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.reason !== undefined ? { reason: values.reason } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.resolvedBy !== undefined ? { resolved_by: values.resolvedBy } : {}),
    ...(values.resolvedAt !== undefined ? { resolved_at: values.resolvedAt } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

export function dispatchLogInsertValues(values: NewDispatchLog): InsertObject<CentreDB, 'notification_dispatch_log'> {
  return {
    user_id: values.userId,
    provider: values.provider,
    channel: values.channel,
    status: values.status,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.notificationId !== undefined ? { notification_id: values.notificationId } : {}),
    ...(values.tenantId !== undefined ? { tenant_id: values.tenantId } : {}),
    ...(values.subject !== undefined ? { subject: values.subject } : {}),
    ...(values.dedupeKey !== undefined ? { dedupe_key: values.dedupeKey } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Kho dữ liệu
// ---------------------------------------------------------------------------

/** Kho dữ liệu nhắn tin và thông báo: conversation, thành viên, message, block, notification, tuỳ chọn kênh và nhật ký dispatch.
 *
 * Facade mỏng trên sáu miền (xem ghi chú đầu file): constructor nhận handle + cổng store, `transaction()` mở giao dịch trên handle gốc, mọi phương thức còn lại uỷ quyền sang class miền tương ứng. Tài liệu đầy đủ của từng phương thức nằm ở file miền chứa cài đặt.
 */
export class MessagingRepository {
  private readonly conversations: MessagingConversationsRepository;
  private readonly contacts: MessagingContactsRepository;
  private readonly enrolment: MessagingEnrolmentRepository;
  private readonly sync: MessagingSyncRepository;
  private readonly tree: MessagingTreeRepository;
  private readonly notifications: MessagingNotificationsRepository;

  constructor(
    private readonly handle: CentreDb,
    private readonly store: MessagingStorePort,
  ) {
    this.conversations = new MessagingConversationsRepository(handle, store);
    this.contacts = new MessagingContactsRepository(handle);
    this.enrolment = new MessagingEnrolmentRepository(handle);
    this.sync = new MessagingSyncRepository(handle, this);
    this.tree = new MessagingTreeRepository(handle);
    this.notifications = new MessagingNotificationsRepository(handle);
  }

  /** Handle gốc của repository (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm (thay `dbHandle.transaction` của bản bộ máy cũ). */
  async transaction<T>(fn: (tx: MessagingTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  async insertConversation(v: NewConversation, db: MessagingDb = this.db()): Promise<ConversationRow> {
    return this.conversations.insertConversation(v, db);
  }

  async getConversation(id: string): Promise<ConversationRow | undefined> {
    return this.conversations.getConversation(id);
  }

  async addMember(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.addMember(conversationId, userId, db);
  }

  async removeMember(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.removeMember(conversationId, userId, db);
  }

  async listMembers(conversationId: string): Promise<string[]> {
    return this.conversations.listMembers(conversationId);
  }

  async isMember(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.conversations.isMember(conversationId, userId, db);
  }

  async listConversationsForUser(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.conversations.listConversationsForUser(userId, db);
  }

  async listConversationSummaries(userId: string, opts: { archivedOnly?: boolean } = {}, db: MessagingDb = this.db()): Promise<ConversationSummaryRow[]> {
    return this.conversations.listConversationSummaries(userId, opts, db);
  }

  async findIndividualConversation(a: string, b: string): Promise<ConversationRow | undefined> {
    return this.conversations.findIndividualConversation(a, b);
  }

  async allocateNextSeq(conversationId: string, tx: MessagingTx): Promise<number> {
    return this.conversations.allocateNextSeq(conversationId, tx);
  }

  async insertMessage(v: NewMessage, db: MessagingDb = this.db()): Promise<MessageRow> {
    return this.conversations.insertMessage(v, db);
  }

  async getMessage(id: string): Promise<MessageRow | undefined> {
    return this.conversations.getMessage(id);
  }

  async getMessageByClientId(conversationId: string, userIdFrom: string, clientMessageId: string, db: MessagingDb = this.db()): Promise<MessageRow | undefined> {
    return this.conversations.getMessageByClientId(conversationId, userIdFrom, clientMessageId, db);
  }

  async listMessages(conversationId: string, opts: MessageWindowOptions = {}): Promise<MessageRow[]> {
    return this.conversations.listMessages(conversationId, opts);
  }

  async searchMessages(conversationId: string, opts: MessageSearchOptions, db: MessagingDb = this.db()): Promise<MessageRow[]> {
    return this.conversations.searchMessages(conversationId, opts, db);
  }

  async hasMessagesBefore(conversationId: string, seq: number, includeDeleted = false, viewerId?: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.conversations.hasMessagesBefore(conversationId, seq, includeDeleted, viewerId, db);
  }

  async softDeleteMessage(id: string, deletedBy: string, db: MessagingDb = this.db()): Promise<MessageRow | undefined> {
    return this.conversations.softDeleteMessage(id, deletedBy, db);
  }

  async markDeletedForUser(messageId: string, userId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.markDeletedForUser(messageId, userId, db);
  }

  async isDeletedForUser(messageId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.conversations.isDeletedForUser(messageId, userId, db);
  }

  async applyRecall(id: string, recalledBy: string, db: MessagingDb = this.db()): Promise<MessageRow | undefined> {
    return this.conversations.applyRecall(id, recalledBy, db);
  }

  async hardDeleteMessage(id: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.hardDeleteMessage(id, db);
  }

  async getMessagesByIds(ids: string[]): Promise<MessageRow[]> {
    return this.conversations.getMessagesByIds(ids);
  }

  async listDeletedForUserIds(messageIds: string[], userId: string): Promise<Set<string>> {
    return this.conversations.listDeletedForUserIds(messageIds, userId);
  }

  async attachQuotes(rows: MessageRow[], opts: { privileged: boolean; viewerId?: string }): Promise<MessageWithQuoteRow[]> {
    return this.conversations.attachQuotes(rows, opts);
  }

  async insertModeratorAction(values: NewModeratorAction, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.insertModeratorAction(values, db);
  }

  async listModeratorActionsForMessage(messageId: string, db: MessagingDb = this.db()): Promise<ModeratorActionRow[]> {
    return this.conversations.listModeratorActionsForMessage(messageId, db);
  }

  async setConversationEnabled(id: string, enabled: boolean, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return this.conversations.setConversationEnabled(id, enabled, db);
  }

  async getMemberLastReadSeq(conversationId: string, userId: string): Promise<number | undefined> {
    return this.conversations.getMemberLastReadSeq(conversationId, userId);
  }

  async listMemberReadMarkers(conversationId: string, db: MessagingDb = this.db()): Promise<{ userId: string; lastReadSeq: number }[]> {
    return this.conversations.listMemberReadMarkers(conversationId, db);
  }

  async getMemberConversationState(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<{ pinnedAt: Date | null; archivedAt: Date | null; muted: boolean } | undefined> {
    return this.conversations.getMemberConversationState(conversationId, userId, db);
  }

  async updateMemberConversationState(
    conversationId: string,
    userId: string,
    patch: { pinned?: boolean; archived?: boolean; muted?: boolean },
    db: MessagingDb = this.db(),
  ): Promise<{ pinnedAt: Date | null; archivedAt: Date | null; muted: boolean } | undefined> {
    return this.conversations.updateMemberConversationState(conversationId, userId, patch, db);
  }

  async listMutedMemberIds(conversationId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.conversations.listMutedMemberIds(conversationId, db);
  }

  async clearArchivedForIncomingMessage(conversationId: string, senderId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.clearArchivedForIncomingMessage(conversationId, senderId, db);
  }

  async markConversationRead(conversationId: string, readerId: string, db: MessagingDb = this.db()): Promise<{ marked: number; lastReadSeq: number }> {
    return this.conversations.markConversationRead(conversationId, readerId, db);
  }

  async countUnreadForConversation(conversationId: string, userId: string): Promise<number> {
    return this.conversations.countUnreadForConversation(conversationId, userId);
  }

  async countUnreadConversations(userId: string, db: MessagingDb = this.db()): Promise<number> {
    return this.conversations.countUnreadConversations(userId, db);
  }

  async block(userId: string, blockedUserId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.block(userId, blockedUserId, db);
  }

  async unblock(userId: string, blockedUserId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.conversations.unblock(userId, blockedUserId, db);
  }

  async isBlocked(userId: string, blockedUserId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.conversations.isBlocked(userId, blockedUserId, db);
  }

  async listBlocked(userId: string): Promise<string[]> {
    return this.conversations.listBlocked(userId);
  }

  async listBlockerIds(userId: string): Promise<string[]> {
    return this.conversations.listBlockerIds(userId);
  }

  async listBlockedCounterpartIds(userId: string): Promise<string[]> {
    return this.conversations.listBlockedCounterpartIds(userId);
  }

  async sharesConversation(viewerId: string, targetId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.conversations.sharesConversation(viewerId, targetId, db);
  }

  async sharesDirectConversation(viewerId: string, targetId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.conversations.sharesDirectConversation(viewerId, targetId, db);
  }

  async addContactPair(a: string, b: string, db: MessagingDb = this.db()): Promise<void> {
    return this.contacts.addContactPair(a, b, db);
  }

  async removeContactPair(a: string, b: string, db: MessagingDb = this.db()): Promise<void> {
    return this.contacts.removeContactPair(a, b, db);
  }

  async listContacts(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.contacts.listContacts(userId, db);
  }

  async isContact(ownerId: string, contactId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.contacts.isContact(ownerId, contactId, db);
  }

  async createContactRequest(fromId: string, toId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.contacts.createContactRequest(fromId, toId, db);
  }

  async getContactRequest(fromId: string, toId: string, db: MessagingDb = this.db()): Promise<ContactRequestRow | undefined> {
    return this.contacts.getContactRequest(fromId, toId, db);
  }

  async deleteContactRequest(fromId: string, toId: string, db: MessagingDb = this.db()): Promise<void> {
    return this.contacts.deleteContactRequest(fromId, toId, db);
  }

  async deleteContactRequestsBetween(a: string, b: string, db: MessagingDb = this.db()): Promise<void> {
    return this.contacts.deleteContactRequestsBetween(a, b, db);
  }

  async listIncomingContactRequests(userId: string, db: MessagingDb = this.db()): Promise<ContactRequestRow[]> {
    return this.contacts.listIncomingContactRequests(userId, db);
  }

  async listOutgoingContactRequests(userId: string, db: MessagingDb = this.db()): Promise<ContactRequestRow[]> {
    return this.contacts.listOutgoingContactRequests(userId, db);
  }

  async hasStaffRoleAssignment(userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.enrolment.hasStaffRoleAssignment(userId, db);
  }

  async hasStudentContext(userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.enrolment.hasStudentContext(userId, db);
  }

  async hasActiveGuardianLink(userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.enrolment.hasActiveGuardianLink(userId, db);
  }

  async listCourseStaffUserIds(courseId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.enrolment.listCourseStaffUserIds(courseId, db);
  }

  async insertReport(v: NewReport, db: MessagingDb = this.db()): Promise<ReportRow> {
    return this.enrolment.insertReport(v, db);
  }

  async getReport(id: string, db: MessagingDb = this.db()): Promise<ReportRow | undefined> {
    return this.enrolment.getReport(id, db);
  }

  async listReports(limit = 200, db: MessagingDb = this.db()): Promise<ReportRow[]> {
    return this.enrolment.listReports(limit, db);
  }

  async updateReportStatus(id: string, status: string, resolvedBy: string | null, db: MessagingDb = this.db()): Promise<ReportRow | undefined> {
    return this.enrolment.updateReportStatus(id, status, resolvedBy, db);
  }

  async activeCourseIds(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.enrolment.activeCourseIds(userId, db);
  }

  async findTeacherStudentSharedCourseId(userA: string, userB: string, db: MessagingDb = this.db()): Promise<string | null> {
    return this.enrolment.findTeacherStudentSharedCourseId(userA, userB, db);
  }

  async isCourseTeachingStaff(courseId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.enrolment.isCourseTeachingStaff(courseId, userId, db);
  }

  async getCourseSummary(courseId: string, db: MessagingDb = this.db()): Promise<{ courseId: string; fullName: string; shortName: string } | undefined> {
    return this.enrolment.getCourseSummary(courseId, db);
  }

  async listMembershipCourseIds(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.enrolment.listMembershipCourseIds(userId, db);
  }

  async isCourseMember(courseId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.enrolment.isCourseMember(courseId, userId, db);
  }

  async listCourseRosterPage(courseId: string, actorId: string, cursor: { displayName: string; username: string; userId: string } | null, limit: number, db: MessagingDb = this.db()): Promise<{
    userId: string; username: string; firstName: string; lastName: string; displayName: string; staff: boolean; enrolled: boolean;
  }[]> {
    return this.enrolment.listCourseRosterPage(courseId, actorId, cursor, limit, db);
  }

  async getCourseGroup(groupId: string, db: MessagingDb = this.db()): Promise<CourseGroupRow | undefined> {
    return this.sync.getCourseGroup(groupId, db);
  }

  async listGroupMemberIds(groupId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.sync.listGroupMemberIds(groupId, db);
  }

  async listGroupIdsForUser(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.sync.listGroupIdsForUser(userId, db);
  }

  async findGroupConversation(groupId: string, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return this.sync.findGroupConversation(groupId, db);
  }

  async listGroupConversationsForGroupMember(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.sync.listGroupConversationsForGroupMember(userId, db);
  }

  async findCourseConversation(courseId: string, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return this.sync.findCourseConversation(courseId, db);
  }

  async acquireCourseConversationLock(tx: MessagingTx, courseId: string): Promise<void> {
    return this.sync.acquireCourseConversationLock(tx, courseId);
  }

  async listActiveEnrolledUserIds(courseId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.sync.listActiveEnrolledUserIds(courseId, db);
  }

  async listCourseConversationMemberIds(courseId: string): Promise<string[]> {
    return this.sync.listCourseConversationMemberIds(courseId);
  }

  async listCourseConversationsForMember(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.sync.listCourseConversationsForMember(userId, db);
  }

  async getClassSummary(classId: string, db: MessagingDb = this.db()): Promise<{ classId: string; name: string; ownerId: string; cohortId: string; tenantId: string; status: string } | undefined> {
    return this.sync.getClassSummary(classId, db);
  }

  async listClassStaffUserIds(classId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.sync.listClassStaffUserIds(classId, db);
  }

  async isClassTeachingStaff(classId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.sync.isClassTeachingStaff(classId, userId, db);
  }

  async listClassRosterMemberIds(classId: string, db: MessagingDb = this.db()): Promise<string[]> {
    return this.sync.listClassRosterMemberIds(classId, db);
  }

  async listClassConversationMemberIds(classId: string): Promise<string[]> {
    return this.sync.listClassConversationMemberIds(classId);
  }

  async isClassMember(classId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.sync.isClassMember(classId, userId, db);
  }

  async findClassConversation(classId: string, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return this.sync.findClassConversation(classId, db);
  }

  async acquireClassConversationLock(tx: MessagingTx, classId: string): Promise<void> {
    return this.sync.acquireClassConversationLock(tx, classId);
  }

  async listClassConversationsForMember(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.sync.listClassConversationsForMember(userId, db);
  }

  async listClassRosterPage(classId: string, actorId: string, cursor: { displayName: string; username: string; userId: string } | null, limit: number, db: MessagingDb = this.db()): Promise<{
    userId: string; username: string; firstName: string; lastName: string; displayName: string; staff: boolean; enrolled: boolean;
  }[]> {
    return this.sync.listClassRosterPage(classId, actorId, cursor, limit, db);
  }

  async findTeacherStudentSharedClassId(userA: string, userB: string, db: MessagingDb = this.db()): Promise<string | null> {
    return this.sync.findTeacherStudentSharedClassId(userA, userB, db);
  }

  async listTreeClassesForUser(userId: string, db: MessagingDb = this.db()): Promise<{ classId: string; name: string; isOwner: boolean; isClassStaff: boolean; isRosterMember: boolean }[]> {
    return this.tree.listTreeClassesForUser(userId, db);
  }

  async listCoursesByClassIds(classIds: string[], db: MessagingDb = this.db()): Promise<{ courseId: string; fullName: string; classId: string }[]> {
    return this.tree.listCoursesByClassIds(classIds, db);
  }

  async listClassesOfCourses(courseIds: string[], db: MessagingDb = this.db()): Promise<{ courseId: string; classId: string; className: string; classStatus: string }[]> {
    return this.tree.listClassesOfCourses(courseIds, db);
  }

  async listCourseNames(courseIds: string[], db: MessagingDb = this.db()): Promise<{ courseId: string; fullName: string }[]> {
    return this.tree.listCourseNames(courseIds, db);
  }

  async listTeachingCourseIds(userId: string, courseIds: string[], db: MessagingDb = this.db()): Promise<string[]> {
    return this.tree.listTeachingCourseIds(userId, courseIds, db);
  }

  async listGroupNames(groupIds: string[], db: MessagingDb = this.db()): Promise<{ groupId: string; name: string; courseId: string }[]> {
    return this.tree.listGroupNames(groupIds, db);
  }

  async listCourseConversationsByCourseIds(courseIds: string[], db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.tree.listCourseConversationsByCourseIds(courseIds, db);
  }

  async listClassConversations(classIds: string[], db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.tree.listClassConversations(classIds, db);
  }

  async listCourseAndClassConversations(db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.tree.listCourseAndClassConversations(db);
  }

  async listGroupConversationsByGroupIds(groupIds: string[], db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return this.tree.listGroupConversationsByGroupIds(groupIds, db);
  }

  async insertNotification(v: NewNotification, db: MessagingDb = this.db()): Promise<NotificationRow> {
    return this.notifications.insertNotification(v, db);
  }

  async countUnreadNotifications(userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    return this.notifications.countUnreadNotifications(userIdTo, tenantId, db);
  }

  async markNotificationRead(id: string, userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.notifications.markNotificationRead(id, userIdTo, tenantId, db);
  }

  async markAllNotificationsRead(userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    return this.notifications.markAllNotificationsRead(userIdTo, tenantId, db);
  }

  async listNotificationGroups(userIdTo: string, opts: {
    eventTypes?: string[];
    unreadOnly?: boolean;
    cursor?: { latestAt: Date; latestId: string };
    limit: number;
  }, tenantId?: string, db: MessagingDb = this.db()): Promise<NotificationGroupAggregateRow[]> {
    return this.notifications.listNotificationGroups(userIdTo, opts, tenantId, db);
  }

  async listNotificationsByIds(ids: string[], tenantId?: string, db: MessagingDb = this.db()): Promise<NotificationRow[]> {
    return this.notifications.listNotificationsByIds(ids, tenantId, db);
  }

  async listNotificationItems(userIdTo: string, opts: NotificationItemsOptions, tenantId?: string, db: MessagingDb = this.db()): Promise<NotificationRow[]> {
    return this.notifications.listNotificationItems(userIdTo, opts, tenantId, db);
  }

  async markNotificationGroupRead(userIdTo: string, key: { eventType: string; sourceKey: string; day: string }, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    return this.notifications.markNotificationGroupRead(userIdTo, key, tenantId, db);
  }

  async deleteNotification(id: string, userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.notifications.deleteNotification(id, userIdTo, tenantId, db);
  }

  async deleteReadNotifications(userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    return this.notifications.deleteReadNotifications(userIdTo, tenantId, db);
  }

  async hasUnreadNotification(userIdTo: string, eventType: string, contextUrl: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.notifications.hasUnreadNotification(userIdTo, eventType, contextUrl, db);
  }

  async getGradeItemNotifyInfo(itemId: string, db: MessagingDb = this.db()): Promise<{ itemType: string; itemName: string; hidden: boolean; courseId: string } | undefined> {
    return this.notifications.getGradeItemNotifyInfo(itemId, db);
  }

  async isGradeHiddenForUser(itemId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    return this.notifications.isGradeHiddenForUser(itemId, userId, db);
  }

  async getCourseFullName(courseId: string, db: MessagingDb = this.db()): Promise<string | undefined> {
    return this.notifications.getCourseFullName(courseId, db);
  }

  async getAssignmentNotifyInfo(assignmentId: string, db: MessagingDb = this.db()): Promise<{
    name: string; courseId: string; courseVisible: boolean; cmVisible: boolean | null; cmDeletionInProgress: boolean | null;
  } | undefined> {
    return this.notifications.getAssignmentNotifyInfo(assignmentId, db);
  }

  async getPinNotifyInfo(pinId: string, db: MessagingDb = this.db()): Promise<{
    name: string; courseId: string; courseVisible: boolean; cmVisible: boolean | null; cmDeletionInProgress: boolean | null;
  } | undefined> {
    return this.notifications.getPinNotifyInfo(pinId, db);
  }

  async countAssignmentSubmissionsAwaitingGrading(assignmentId: string, db: MessagingDb = this.db()): Promise<number> {
    return this.notifications.countAssignmentSubmissionsAwaitingGrading(assignmentId, db);
  }

  async countPinAttemptsNeedingGrading(pinId: string, db: MessagingDb = this.db()): Promise<number> {
    return this.notifications.countPinAttemptsNeedingGrading(pinId, db);
  }

  async getUnreadNotification(userIdTo: string, eventType: string, contextUrl: string, db: MessagingDb = this.db()): Promise<NotificationRow | undefined> {
    return this.notifications.getUnreadNotification(userIdTo, eventType, contextUrl, db);
  }

  async updateNotificationContent(id: string, subject: string, fullMessage: string, db: MessagingDb = this.db()): Promise<void> {
    return this.notifications.updateNotificationContent(id, subject, fullMessage, db);
  }

  async getCourseTenantId(courseId: string, db: MessagingDb = this.db()): Promise<string | null> {
    return this.notifications.getCourseTenantId(courseId, db);
  }

  async getConversationTenantId(conversationId: string): Promise<string | null> {
    return this.conversations.getConversationTenantId(conversationId);
  }

  async getUserDefaultTenantId(userId: string, db: MessagingDb = this.db()): Promise<string | null> {
    return this.notifications.getUserDefaultTenantId(userId, db);
  }

  async insertDispatchLog(v: NewDispatchLog, db: MessagingDb = this.db()): Promise<DispatchLogRow> {
    return this.notifications.insertDispatchLog(v, db);
  }

  async listDispatchLog(userId: string, db: MessagingDb = this.db()): Promise<DispatchLogRow[]> {
    return this.notifications.listDispatchLog(userId, db);
  }
}
