/**
 * Hội thoại, thành viên và tin nhắn — phần lõi: tạo/đọc hội thoại, quản lý thành viên, gửi/đọc tin, chặn liên lạc và trạng thái đọc của từng thành viên.
 *
 * Một miền của {@link MessagingRepository} (xem `messaging.ts`): nhận handle kho trung tâm qua constructor, mọi phương thức nhận handle tuỳ chọn `db` mặc định là handle gốc (khuôn S6) — facade ở `messaging.ts` giữ nguyên API public và uỷ quyền sang đây.
 */
import {
  sql,
  type Expression,
  type SqlBool,
} from 'kysely';
import type { CentreDb } from '../client';
import {
  CONVERSATION_COLUMNS,
  CONVERSATION_COLUMNS_QUALIFIED,
  MESSAGE_COLUMNS,
  MODERATOR_ACTION_COLUMNS,
  conversationInsertValues,
  messageInsertValues,
  type ConversationRow,
  type ConversationSummaryRawRow,
  type ConversationSummaryRow,
  type MessageRow,
  type MessageSearchOptions,
  type MessageWindowOptions,
  type MessageWithQuoteRow,
  type MessagingDb,
  type MessagingStorePort,
  type MessagingTx,
  type ModeratorActionRow,
  type NewConversation,
  type NewMessage,
  type NewModeratorAction,
} from './messaging';

/** Hội thoại, thành viên và tin nhắn — phần lõi: tạo/đọc hội thoại, quản lý thành viên, gửi/đọc tin, chặn liên lạc và trạng thái đọc của từng thành viên. */
export class MessagingConversationsRepository {
  constructor(
    private readonly handle: CentreDb,
    private readonly store: MessagingStorePort,
  ) {}

  /** Handle gốc của miền (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }


  /**
   * Chèn conversation.
   */
  async insertConversation(v: NewConversation, db: MessagingDb = this.db()): Promise<ConversationRow> {
    return db
      .insertInto('message_conversations')
      .values(conversationInsertValues(v))
      .returning(CONVERSATION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Lấy conversation theo id. Cài đặt truy vấn ở bề mặt đọc dùng
   * chung `@giaokhoa/messaging` — repository chỉ uỷ quyền qua cổng
   * {@link MessagingStorePort} (issue #521).
   */
  async getConversation(id: string): Promise<ConversationRow | undefined> {
    return this.store.getConversationById(id);
  }

  /**
   * Thêm thành viên conversation.
   */
  async addMember(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .insertInto('message_conversation_members')
      .values({ conversation_id: conversationId, user_id: userId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Gỡ một thành viên khỏi conversation (dùng cho đồng bộ group conversation:
   * người rời group thì rời conversation, tin nhắn cũ giữ nguyên).
   */
  async removeMember(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .deleteFrom('message_conversation_members')
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Thành viên của conversation. Cài đặt truy vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging` — repository chỉ uỷ quyền (issue #521).
   */
  async listMembers(conversationId: string): Promise<string[]> {
    return this.store.listConversationMemberIds(conversationId);
  }

  /**
   * User có thuộc conversation hay không.
   */
  async isMember(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('message_conversation_members')
      .select('user_id')
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .execute();
    return rows.length > 0;
  }

  /**
   * Conversation của user, mới nhất trước (một truy vấn join).
   */
  async listConversationsForUser(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return db
      .selectFrom('message_conversation_members')
      .innerJoin('message_conversations', 'message_conversations.id', 'message_conversation_members.conversation_id')
      .select(CONVERSATION_COLUMNS_QUALIFIED)
      .where('message_conversation_members.user_id', '=', userId)
      .orderBy('message_conversations.updated_at', 'desc')
      .execute();
  }

  /**
   * Danh sách conversation kèm số chưa đọc + tin cuối cho một user — MỘT truy vấn duy nhất: unread đếm bằng count(*) theo mốc last-read của chính user, tin cuối lấy bằng lateral theo seq.
   *
   * Lát M5 (issue #240): kèm ba trạng thái cá nhân của chính user; mặc định CHỈ các conversation chưa lưu trữ, `archivedOnly` thì chỉ các conversation ĐÃ lưu — hai mục không bao giờ trộn nhau. Thứ tự: conversation ĐÃ GHIM lên đầu (trong nhóm ghim vẫn theo hoạt động gần nhất), còn lại theo hoạt động gần nhất.
   *
   * Vũ trụ đếm chuẩn (issue #592): `unread` ở đây là số chưa đọc THEO VŨ TRỤ CHUẨN — hội thoại đã tắt tiếng trả 0 dù tin chưa đọc vẫn còn, để mọi bề mặt suy từ danh sách này (huy hiệu đầu trang, huy hiệu hàng, chip lọc, cây nhóm) khớp với huy hiệu thanh bên mà không cần lọc lại ở client. Hội thoại 1–1 bị ẩn do chặn không xuất hiện trong danh sách nên cũng không đóng góp số. Mốc đã đọc và tin cuối không bị ảnh hưởng: bật tiếng lại thì số thật hiện lại ngay.
   */
  async listConversationSummaries(userId: string, opts: { archivedOnly?: boolean } = {}, db: MessagingDb = this.db()): Promise<ConversationSummaryRow[]> {
    const archivedClause = opts.archivedOnly
      ? sql`AND mine.archived_at IS NOT NULL`
      : sql`AND mine.archived_at IS NULL`;
    const executed = await sql<ConversationSummaryRawRow>`
      SELECT c.id AS conversation_id, c.type AS conversation_type, c.name AS conversation_name,
        c.component AS conversation_component, c.item_type AS conversation_item_type,
        c.item_id AS conversation_item_id, c.context_id AS conversation_context_id,
        c.enabled AS conversation_enabled, c.created_by AS conversation_created_by,
        c.tenant_id AS conversation_tenant_id,
        c.last_message_seq AS conversation_last_seq,
        c.created_at AS conversation_created_at, c.updated_at AS conversation_updated_at,
        mine.last_read_seq AS last_read_seq,
        mine.pinned_at AS pinned_at, mine.archived_at AS archived_at, mine.muted AS muted,
        COALESCE(mem.members, ARRAY[]::uuid[]) AS members,
        COALESCE(u.unread, 0)::int AS unread_count,
        lm.last_message AS last_message
      FROM message_conversation_members mine
      JOIN message_conversations c ON c.id = mine.conversation_id
      LEFT JOIN LATERAL (
        SELECT array_agg(user_id ORDER BY created_at, user_id) AS members
        FROM message_conversation_members WHERE conversation_id = c.id
      ) mem ON true
      LEFT JOIN LATERAL (
        SELECT CASE WHEN mine.muted THEN 0 ELSE count(*) END AS unread FROM message msg
        WHERE msg.conversation_id = c.id AND msg.seq > mine.last_read_seq AND msg.user_id_from <> mine.user_id
          AND msg.deleted_at IS NULL
          -- Tin đã THU HỒI không còn nội dung để đọc — không đếm chưa
          -- đọc; tin người xem đã xoá-phía-mình cũng ra khỏi tầm nhìn
          -- của chính họ nên không đếm (vòng đời theo vai, #33).
          AND msg.recalled_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM message_user_deletions d
            WHERE d.message_id = msg.id AND d.user_id = mine.user_id
          )
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT to_jsonb(msg) AS last_message FROM message msg
        WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
          -- Tin cuối là tin cuối CÒN HIỂN THỊ với chính người xem:
          -- tin họ đã xoá-phía-mình không được làm xem trước của họ.
          -- Tin đã thu hồi VẪN được chọn (nội dung bị vô hiệu hoá ở
          -- tầng service — xem trước hiện dòng thu hồi, không lùi về
          -- tin cũ hơn như thể cuộc trò chuyện trống rỗng đi).
          AND NOT EXISTS (
            SELECT 1 FROM message_user_deletions d
            WHERE d.message_id = msg.id AND d.user_id = mine.user_id
          )
        ORDER BY msg.seq DESC LIMIT 1
      ) lm ON true
      WHERE mine.user_id = ${userId}
        ${archivedClause}
        -- Chuẩn app nhắn tin (chốt bổ sung trên issue #33, 24/10/2026):
        -- có quan hệ chặn ở BẤT KỲ chiều nào thì conversation 1–1 bị
        -- ẨN khỏi danh sách của CẢ HAI phía (dữ liệu giữ nguyên, bỏ
        -- chặn là hiện lại). Conversation nhóm không bị luật này chạm.
        AND NOT (c.type = 1 AND EXISTS (
          SELECT 1 FROM message_conversation_members other_m
          JOIN message_users_blocked b
            ON (b.user_id = mine.user_id AND b.blocked_user_id = other_m.user_id)
            OR (b.user_id = other_m.user_id AND b.blocked_user_id = mine.user_id)
          WHERE other_m.conversation_id = c.id AND other_m.user_id <> mine.user_id
        ))
      ORDER BY (mine.pinned_at IS NOT NULL) DESC, c.updated_at DESC
    `.execute(db);
    return executed.rows.map((raw) => {
      const lastMessageRaw = raw.last_message;
      return {
        conversation: {
          id: raw.conversation_id,
          type: raw.conversation_type,
          name: raw.conversation_name,
          component: raw.conversation_component,
          itemType: raw.conversation_item_type,
          itemId: raw.conversation_item_id,
          contextId: raw.conversation_context_id,
          enabled: raw.conversation_enabled,
          createdBy: raw.conversation_created_by,
          tenantId: raw.conversation_tenant_id,
          lastMessageSeq: raw.conversation_last_seq,
          createdAt: raw.conversation_created_at,
          updatedAt: raw.conversation_updated_at,
        },
        members: raw.members,
        lastReadSeq: raw.last_read_seq,
        unreadCount: raw.unread_count,
        pinnedAt: raw.pinned_at,
        archivedAt: raw.archived_at,
        muted: raw.muted,
        lastMessage: lastMessageRaw
          ? {
              id: lastMessageRaw.id,
              conversationId: lastMessageRaw.conversation_id,
              userIdFrom: lastMessageRaw.user_id_from,
              subject: lastMessageRaw.subject,
              fullMessage: lastMessageRaw.full_message,
              smallMessage: lastMessageRaw.small_message,
              seq: lastMessageRaw.seq,
              clientMessageId: lastMessageRaw.client_message_id,
              replyToMessageId: lastMessageRaw.reply_to_message_id,
              deletedAt: lastMessageRaw.deleted_at ? new Date(lastMessageRaw.deleted_at) : null,
              deletedBy: lastMessageRaw.deleted_by,
              recalledAt: lastMessageRaw.recalled_at ? new Date(lastMessageRaw.recalled_at) : null,
              recalledBy: lastMessageRaw.recalled_by,
              createdAt: new Date(lastMessageRaw.created_at),
            }
          : null,
      };
    });
  }

  /**
   * Tìm conversation 1-1 giữa hai user.
   */
  async findIndividualConversation(a: string, b: string): Promise<ConversationRow | undefined> {
    const mine = await this.listConversationsForUser(a);
    for (const c of mine) {
      if (c.type !== 1) continue;
      const members = await this.listMembers(c.id);
      if (members.length === 2 && members.includes(b)) return c;
    }
    return undefined;
  }

  /**
   * Cấp seq tiếp theo cho một tin mới trong conversation: tăng bộ đếm
   * trên dòng conversation và chạm updated_at trong CÙNG một lệnh
   * UPDATE — khoá dòng của UPDATE khiến các transaction gửi đồng thời
   * xếp hàng trên dòng này, seq không bao giờ trùng hay nhảy cóc.
   * Phải gọi trong transaction sẽ chèn tin (seq và tin commit cùng lúc).
   */
  async allocateNextSeq(conversationId: string, tx: MessagingTx): Promise<number> {
    const row = await tx
      .updateTable('message_conversations')
      .set({ last_message_seq: sql<number>`last_message_seq + 1`, updated_at: new Date() })
      .where('id', '=', conversationId)
      .returning('last_message_seq as seq')
      .executeTakeFirstOrThrow();
    return row.seq;
  }


  /**
   * Chèn tin nhắn.
   */
  async insertMessage(v: NewMessage, db: MessagingDb = this.db()): Promise<MessageRow> {
    return db
      .insertInto('message')
      .values(messageInsertValues(v))
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Lấy tin nhắn theo id. Cài đặt truy vấn ở bề mặt đọc dùng
   * chung `@giaokhoa/messaging` — repository chỉ uỷ quyền (issue #521).
   */
  async getMessage(id: string): Promise<MessageRow | undefined> {
    return this.store.getMessageById(id);
  }

  /**
   * Tin đã lưu với khoá chống trùng (conversation, người gửi,
   * clientMessageId) — đường tra cứu cho gửi lại idempotent.
   */
  async getMessageByClientId(conversationId: string, userIdFrom: string, clientMessageId: string, db: MessagingDb = this.db()): Promise<MessageRow | undefined> {
    return db
      .selectFrom('message')
      .select(MESSAGE_COLUMNS)
      .where('conversation_id', '=', conversationId)
      .where('user_id_from', '=', userIdFrom)
      .where('client_message_id', '=', clientMessageId)
      .executeTakeFirst();
  }

  /**
   * Một cửa sổ tin của conversation theo cursor seq, luôn trả tăng dần
   * theo seq. Không cursor: cửa sổ MỚI NHẤT (limit tin cuối). beforeSeq:
   * cửa sổ ngay trước mốc. afterSeq: các tin sau mốc (đồng bộ thiếu
   * hụt). Cài đặt truy vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging` —
   * repository chỉ uỷ quyền (issue #521).
   */
  async listMessages(conversationId: string, opts: MessageWindowOptions = {}): Promise<MessageRow[]> {
    return this.store.listMessagesPage(conversationId, opts);
  }

  /**
   * Tìm nội dung tin trong MỘT conversation (lát M4, issue #237):
   * khớp chuỗi con trên `full_message` bằng ILIKE (không phân biệt
   * hoa thường), kết quả mới nhất (seq cao nhất) trước. Tầm nhìn
   * khóa theo ĐÚNG luật bề mặt đọc hiện hành: người thường chỉ khớp
   * tin còn hiển thị với chính họ — tin đã xoá mềm, đã THU HỒI (nội
   * dung đã vô hiệu: khớp trên nội dung gốc của tin thu hồi sẽ lộ
   * rằng nội dung đó từng tồn tại), tin họ đã xoá-phía-mình, và tin
   * của phía có quan hệ chặn hai chiều đều bị loại NGAY TẠI SQL.
   * Người có thẩm quyền (privileged) tìm theo tầm nhìn truy vết.
   * Ký tự đặc biệt của mẫu LIKE trong truy vấn của người dùng được
   * thoát để tìm là tìm CHUỖI CON đúng nghĩa, không phải mẫu.
   */
  async searchMessages(conversationId: string, opts: MessageSearchOptions, db: MessagingDb = this.db()): Promise<MessageRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const escaped = opts.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const pattern = `%${escaped}%`;
    return db
      .selectFrom('message')
      .select(MESSAGE_COLUMNS)
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('conversation_id', '=', conversationId),
          sql<SqlBool>`full_message ilike ${pattern}`,
        ];
        if (!opts.privileged) {
          conds.push(eb('deleted_at', 'is', null));
          conds.push(eb('recalled_at', 'is', null));
          if (opts.viewerId) {
            const viewerId = opts.viewerId;
            conds.push(sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${viewerId})`);
          }
          if (opts.excludedAuthorIds && opts.excludedAuthorIds.length > 0) {
            conds.push(eb('user_id_from', 'not in', opts.excludedAuthorIds));
          }
        }
        return eb.and(conds);
      })
      .orderBy('seq', 'desc')
      .limit(limit)
      .execute();
  }

  /** Còn tin cũ hơn seq này trong conversation hay không (cho nút tải thêm). */
  async hasMessagesBefore(conversationId: string, seq: number, includeDeleted = false, viewerId?: string, db: MessagingDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('message')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('conversation_id', '=', conversationId),
          eb('seq', '<', seq),
        ];
        if (!includeDeleted) conds.push(eb('deleted_at', 'is', null));
        // Cùng luật lọc xoá-phía-mình như listMessages: nếu không, mốc
        // "còn tin cũ hơn" sẽ đúng giả khi mọi tin cũ hơn đã bị chính
        // người xem ẩn đi (client tải thêm một trang rỗng vô ích).
        if (viewerId && !includeDeleted) {
          conds.push(sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${viewerId})`);
        }
        return eb.and(conds);
      })
      .executeTakeFirst();
    return (row?.value ?? 0) > 0;
  }

  /**
   * Xoá mềm một tin: chỉ đánh dấu `deleted_at`/`deleted_by`, dòng tin
   * giữ nguyên nội dung phục vụ truy vết của người có thẩm quyền.
   * Tin đã xoá rồi thì giữ nguyên dấu vết lần xoá đầu (idempotent ở
   * tầng service).
   */
  async softDeleteMessage(id: string, deletedBy: string, db: MessagingDb = this.db()): Promise<MessageRow | undefined> {
    return db
      .updateTable('message')
      .set({ deleted_at: new Date(), deleted_by: deletedBy })
      .where('id', '=', id)
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Đặt cờ XOÁ-PHÍA-MÌNH cho một user trên một tin (lớp (a) của vòng
   * đời theo vai): idempotent — đặt lại cùng cờ là no-op nhờ PK phức
   * hợp + onConflictDoNothing. Chỉ ẩn tin khỏi tầm nhìn của chính
   * user đó; không đụng tới dòng tin.
   */
  async markDeletedForUser(messageId: string, userId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .insertInto('message_user_deletions')
      .values({ message_id: messageId, user_id: userId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** User này đã đặt cờ xoá-phía-mình trên tin này chưa. */
  async isDeletedForUser(messageId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('message_user_deletions')
      .select('message_id as messageId')
      .where('message_id', '=', messageId)
      .where('user_id', '=', userId)
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  /**
   * Áp dấu THU HỒI lên dòng tin (lớp (b)): chỉ set hai cột dấu vết,
   * nội dung giữ nguyên trong DB — việc vô hiệu hoá nội dung thuộc
   * về đường đọc (người xem thường) và đường phân phối realtime.
   */
  async applyRecall(id: string, recalledBy: string, db: MessagingDb = this.db()): Promise<MessageRow | undefined> {
    return db
      .updateTable('message')
      .set({ recalled_at: new Date(), recalled_by: recalledBy })
      .where('id', '=', id)
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Xoá CỨNG một dòng tin (lớp (c)): xoá vật lý; các cờ xoá-phía-mình
   * cascade theo, dấu vết moderator_action KHÔNG cascade (cố ý không
   * khoá ngoại) nên vẫn còn để truy vết.
   */
  async hardDeleteMessage(id: string, db: MessagingDb = this.db()): Promise<void> {
    await db.deleteFrom('message').where('id', '=', id).execute();
  }

  /**
   * Lấy nhiều dòng tin theo id (kiểm tra thẩm quyền hàng loạt trước
   * khi gỡ). Cài đặt truy vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging`.
   */
  async getMessagesByIds(ids: string[]): Promise<MessageRow[]> {
    return this.store.getMessagesByIds(ids);
  }

  /**
   * Trong tập id này, các tin user đã đặt cờ xoá-phía-mình. Cài đặt
   * truy vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging`.
   */
  async listDeletedForUserIds(messageIds: string[], userId: string): Promise<Set<string>> {
    return this.store.listDeletedForUserIds(messageIds, userId);
  }

  /**
   * Gắn khối trích dẫn (lát M3, issue #229) cho một lô tin: tra lô
   * các tin gốc một lần (không N+1), dựng quote theo quyền của người
   * nhận bằng `messageQuoteOf` của `@giaokhoa/messaging`. Tin gốc tra
   * không thấy (chỉ còn xảy ra khi khoá ngoại chưa kịp set null
   * sau xoá cứng) hoặc thuộc conversation khác (dữ liệu không thể
   * sinh qua đường gửi — gác ở service) thì `replyTo = null`: hiển
   * thị như tin thường, không dựng khối trích dẫn rỗng.
   *
   * `viewerId` chỉ áp khi KHÔNG privileged: tin gốc bị chính người
   * xem xoá-phía-mình thì quote thành unavailable như đã xoá. Đường
   * realtime phân phối theo room dùng privileged=false và KHÔNG
   * truyền viewerId (khối trích dẫn là dữ kiện chung của room; việc
   * cá nhân hoá xoá-phía-mình chốt ở các đường đọc REST/sync vốn có
   * viewerId — người đã ẩn tin gốc vốn đã thấy nó khi còn là thành
   * viên nên đây không phải kênh lộ nội dung mới).
   */
  async attachQuotes(rows: MessageRow[], opts: { privileged: boolean; viewerId?: string }): Promise<MessageWithQuoteRow[]> {
    return this.store.attachQuotesToRows(rows, opts);
  }

  /**
   * Ghi một dòng dấu vết hành động kiểm duyệt. Gọi TRƯỚC khi trạng
   * thái tin thay đổi (nhất là trước xoá cứng) để dấu vết không bao
   * giờ thiếu cho một thay đổi đã xảy ra.
   */
  async insertModeratorAction(values: NewModeratorAction, db: MessagingDb = this.db()): Promise<void> {
    await db
      .insertInto('message_moderator_actions')
      .values({
        message_id: values.messageId,
        conversation_id: values.conversationId,
        actor_id: values.actorId,
        author_id: values.authorId,
        action: values.action,
        reason: values.reason ?? null,
        message_seq: values.messageSeq ?? null,
      })
      .execute();
  }

  /** Dấu vết kiểm duyệt của một tin (đường truy vết/test đối chiếu). */
  async listModeratorActionsForMessage(messageId: string, db: MessagingDb = this.db()): Promise<ModeratorActionRow[]> {
    return db
      .selectFrom('message_moderator_actions')
      .select(MODERATOR_ACTION_COLUMNS)
      .where('message_id', '=', messageId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Bật/tắt chat của một conversation (giáo viên phụ trách tắt chat nhóm lớp). */
  async setConversationEnabled(id: string, enabled: boolean, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return db
      .updateTable('message_conversations')
      .set({ enabled, updated_at: new Date() })
      .where('id', '=', id)
      .returning(CONVERSATION_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Mốc đã đọc của một thành viên (undefined nếu không phải thành
   * viên). Cài đặt truy vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging`.
   */
  async getMemberLastReadSeq(conversationId: string, userId: string): Promise<number | undefined> {
    return this.store.getMemberLastReadSeq(conversationId, userId);
  }

  /**
   * Mốc đã đọc của mọi thành viên — cho client hiển thị biên "đã xem".
   */
  async listMemberReadMarkers(conversationId: string, db: MessagingDb = this.db()): Promise<{ userId: string; lastReadSeq: number }[]> {
    return db
      .selectFrom('message_conversation_members')
      .select(['user_id as userId', 'last_read_seq as lastReadSeq'])
      .where('conversation_id', '=', conversationId)
      .execute();
  }

  /**
   * Ba trạng thái cá nhân của MỘT thành viên trên MỘT conversation
   * (lát M5, issue #240) — undefined nếu user không phải thành viên.
   */
  async getMemberConversationState(conversationId: string, userId: string, db: MessagingDb = this.db()): Promise<{ pinnedAt: Date | null; archivedAt: Date | null; muted: boolean } | undefined> {
    return db
      .selectFrom('message_conversation_members')
      .select(['pinned_at as pinnedAt', 'archived_at as archivedAt', 'muted'])
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  /**
   * Đặt trạng thái cá nhân của CHÍNH một thành viên (lát M5): chỉ các
   * trường có mặt trong `patch` mới đổi — ghim/lưu đặt mốc thời gian
   * hiện tại khi bật và xoá mốc (null) khi tắt; tắt tiếng là cờ
   * boolean. Trả trạng thái sau khi đặt (undefined nếu không phải
   * thành viên — tầng service đã gác thành viên trước khi gọi).
   */
  async updateMemberConversationState(
    conversationId: string,
    userId: string,
    patch: { pinned?: boolean; archived?: boolean; muted?: boolean },
    db: MessagingDb = this.db(),
  ): Promise<{ pinnedAt: Date | null; archivedAt: Date | null; muted: boolean } | undefined> {
    const set: { pinned_at?: Date | null; archived_at?: Date | null; muted?: boolean } = {};
    if (patch.pinned !== undefined) set.pinned_at = patch.pinned ? new Date() : null;
    if (patch.archived !== undefined) set.archived_at = patch.archived ? new Date() : null;
    if (patch.muted !== undefined) set.muted = patch.muted;
    if (Object.keys(set).length === 0) return this.getMemberConversationState(conversationId, userId, db);
    return db
      .updateTable('message_conversation_members')
      .set(set)
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .returning(['pinned_at as pinnedAt', 'archived_at as archivedAt', 'muted'])
      .executeTakeFirst();
  }

  /**
   * Các thành viên đã TẮT TIẾNG một conversation (lát M5) — consumer
   * thông báo đọc tập này MỘT lần cho mỗi sự kiện tin mới rồi bỏ qua
   * các thành viên trong tập khi sinh `message_new`.
   */
  async listMutedMemberIds(conversationId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('message_conversation_members')
      .select('user_id as userId')
      .where('conversation_id', '=', conversationId)
      .where('muted', '=', true)
      .execute();
    return rows.map((r) => r.userId);
  }

  /**
   * Tin mới vào conversation thì các thành viên còn lại TỰ BỎ LƯU
   * (lát M5, quyết định đã chốt: hội thoại đã lưu tự hiện lại khi có
   * tin mới): xoá `archived_at` của mọi thành viên TRỪ người gửi,
   * trong CÙNG transaction với lần chèn tin — danh sách của người
   * nhận không bao giờ ở trạng thái "có tin mới nhưng vẫn ẩn vì lưu".
   */
  async clearArchivedForIncomingMessage(conversationId: string, senderId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .updateTable('message_conversation_members')
      .set({ archived_at: null })
      .where('conversation_id', '=', conversationId)
      .where('user_id', '<>', senderId)
      .where('archived_at', 'is not', null)
      .execute();
  }

  /**
   * Đánh dấu một thành viên đã đọc tới tin mới nhất hiện có: nâng mốc
   * last-read của RIÊNG thành viên đó lên last_message_seq của
   * conversation. Trả số tin vừa được đánh dấu (tin của người khác nằm
   * trên mốc cũ) và mốc mới.
   */
  async markConversationRead(conversationId: string, readerId: string, db: MessagingDb = this.db()): Promise<{ marked: number; lastReadSeq: number }> {
    const member = await db
      .selectFrom('message_conversation_members')
      .select(['conversation_id as conversationId', 'user_id as userId', 'last_read_seq as lastReadSeq', 'pinned_at as pinnedAt', 'archived_at as archivedAt', 'muted', 'created_at as createdAt'])
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', readerId)
      .executeTakeFirst();
    if (!member) return { marked: 0, lastReadSeq: 0 };
    const conversation = await db
      .selectFrom('message_conversations')
      .select('last_message_seq as lastMessageSeq')
      .where('id', '=', conversationId)
      .executeTakeFirst();
    const target = conversation?.lastMessageSeq ?? member.lastReadSeq;
    const unread = await db
      .selectFrom('message')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => eb.and([
        eb('conversation_id', '=', conversationId),
        eb('seq', '>', member.lastReadSeq),
        eb('seq', '<=', target),
        eb('user_id_from', '<>', readerId),
        eb('deleted_at', 'is', null),
        // Tin đã thu hồi/đã xoá-phía-mình không tính là "vừa đánh dấu
        // đọc" — nhất quán với mọi bộ đếm chưa đọc khác của vòng đời.
        eb('recalled_at', 'is', null),
        sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${readerId})`,
      ]))
      .executeTakeFirst();
    if (target > member.lastReadSeq) {
      await db
        .updateTable('message_conversation_members')
        .set({ last_read_seq: target })
        .where('conversation_id', '=', conversationId)
        .where('user_id', '=', readerId)
        .execute();
    }
    return { marked: unread?.value ?? 0, lastReadSeq: target };
  }

  /**
   * Số tin chưa đọc của MỘT user trong MỘT conversation (đếm bằng
   * count(*) theo mốc đã đọc của chính user — consumer realtime dùng
   * để gửi kèm sự kiện cập nhật cho từng người nhận). Cài đặt truy
   * vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging` — repository chỉ
   * uỷ quyền (issue #521).
   */
  async countUnreadForConversation(conversationId: string, userId: string): Promise<number> {
    return this.store.countUnreadForConversation(conversationId, userId);
  }

  /**
   * Số conversation có tin chưa đọc của user — một truy vấn EXISTS theo
   * mốc đã đọc của từng thành viên, không tải lịch sử về đếm.
   */
  async countUnreadConversations(userId: string, db: MessagingDb = this.db()): Promise<number> {
    const row = await db
      .selectFrom('message_conversation_members')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => eb.and([
        eb('user_id', '=', userId),
        // Conversation đã TẮT TIẾNG không tính vào huy hiệu điều
        // hướng (lát M5) và cũng không tính ở bất kỳ bề mặt nào
        // khác theo vũ trụ chuẩn duy nhất (issue #592): tin vẫn
        // tới, mốc đã đọc và tin cuối không đổi, nhưng số chưa
        // đọc trả về bằng 0 ở mọi nơi cho tới khi bật lại tiếng.
        eb('muted', '=', false),
        sql<SqlBool>`exists (
          select 1 from message msg
          where msg.conversation_id = message_conversation_members.conversation_id
            and msg.seq > message_conversation_members.last_read_seq
            and msg.user_id_from <> ${userId}
            and msg.deleted_at is null
            and msg.recalled_at is null
            and not exists (
              select 1 from message_user_deletions d
              where d.message_id = msg.id and d.user_id = ${userId}
            )
        )`,
        // Conversation 1–1 đang bị ẩn vì quan hệ chặn (xem
        // listConversationSummaries) cũng không đếm vào huy hiệu chưa
        // đọc — danh sách không thấy thì huy hiệu không được lộ.
        sql<SqlBool>`not exists (
          select 1 from message_conversations c
          join message_conversation_members other_m
            on other_m.conversation_id = c.id and other_m.user_id <> ${userId}
          join message_users_blocked b
            on (b.user_id = ${userId} and b.blocked_user_id = other_m.user_id)
            or (b.user_id = other_m.user_id and b.blocked_user_id = ${userId})
          where c.id = message_conversation_members.conversation_id and c.type = 1
        )`,
      ]))
      .executeTakeFirst();
    return row?.value ?? 0;
  }


  /**
   * Chặn liên lạc từ một user.
   */
  async block(userId: string, blockedUserId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .insertInto('message_users_blocked')
      .values({ user_id: userId, blocked_user_id: blockedUserId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Bỏ chặn.
   */
  async unblock(userId: string, blockedUserId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .deleteFrom('message_users_blocked')
      .where('user_id', '=', userId)
      .where('blocked_user_id', '=', blockedUserId)
      .execute();
  }

  /**
   * A có chặn B hay không.
   */
  async isBlocked(userId: string, blockedUserId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('message_users_blocked')
      .select('user_id')
      .where('user_id', '=', userId)
      .where('blocked_user_id', '=', blockedUserId)
      .execute();
    return rows.length > 0;
  }

  /**
   * Danh sách user bị chặn. Cài đặt truy vấn ở bề mặt đọc dùng chung
   * `@giaokhoa/messaging` — repository chỉ uỷ quyền (issue #521).
   */
  async listBlocked(userId: string): Promise<string[]> {
    return this.store.listBlockedUserIds(userId);
  }

  /**
   * Danh sách user ĐÃ CHẶN user này (chiều ngược của listBlocked) —
   * danh sách thành viên khoá dùng để giấu phía chặn khỏi roster của
   * phía bị chặn, khớp ngữ nghĩa chặn hiện có. Cài đặt truy vấn ở
   * bề mặt đọc dùng chung `@giaokhoa/messaging` (issue #521).
   */
  async listBlockerIds(userId: string): Promise<string[]> {
    return this.store.listBlockerUserIds(userId);
  }

  /**
   * Mọi user đang có quan hệ chặn với user này ở BẤT KỲ chiều nào
   * (người mình chặn ∪ người chặn mình) — tập "đối tác bị chặn" dùng
   * cho các luật ẩn bề mặt 1–1 (presence, mốc đã đọc). Cài đặt truy
   * vấn ở bề mặt đọc dùng chung `@giaokhoa/messaging` (issue #521).
   */
  async listBlockedCounterpartIds(userId: string): Promise<string[]> {
    return this.store.listBlockedCounterpartIds(userId);
  }


  /**
   * Hai user có chung ít nhất một conversation NHÌN THẤY ĐƯỢC với
   * nhau hay không (issue #592 — cổng của endpoint hồ sơ người
   * phục vụ panel chat 1–1): chung dòng thành viên ở cùng một
   * conversation, TRỪ conversation 1–1 đang bị ẩn do quan hệ chặn
   * ở bất kỳ chiều nào (đường đó đối với cả hai phía như không
   * tồn tại, đúng luật ẩn bề mặt 1–1 khi chặn). Hội thoại nhóm
   * không bị luật chặn chạm tới. Chính mình với mình luôn được
   * coi là "chung" (hồ sơ của chính chủ không cần cổng này).
   *
   * @param viewerId - Người xem cần kiểm.
   * @param targetId - Người cần xem hồ sơ.
   * @returns `true` khi hai người chung một conversation nhìn thấy được.
   */
  async sharesConversation(viewerId: string, targetId: string, db: MessagingDb = this.db()): Promise<boolean> {
    if (viewerId === targetId) return true;
    const row = await db
      .selectFrom('message_conversation_members')
      .innerJoin('message_conversations', 'message_conversations.id', 'message_conversation_members.conversation_id')
      .select(sql<number>`1`.as('value'))
      .where((eb) => eb.and([
        eb('message_conversation_members.user_id', '=', viewerId),
        sql<SqlBool>`exists (
          select 1 from message_conversation_members other_m
          where other_m.conversation_id = message_conversation_members.conversation_id
            and other_m.user_id = ${targetId}
        )`,
        sql<SqlBool>`not (
          message_conversations.type = 1 and exists (
            select 1 from message_users_blocked b
            where (b.user_id = ${viewerId} and b.blocked_user_id = ${targetId})
               or (b.user_id = ${targetId} and b.blocked_user_id = ${viewerId})
          )
        )`,
      ]))
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }


  /**
   * Hai người có chung ít nhất một hội thoại 1–1 KHÔNG bị chặn hay
   * không (cổng hồ sơ chat 1–1, issue #592): cùng câu truy vấn với
   * {@link sharesConversation} nhưng giới hạn `type = 1` — hội thoại
   * nhóm/lớp/khoá chung không tính, và quan hệ chặn ở bất kỳ chiều
   * nào cũng loại như luật ẩn bề mặt 1–1 khi chặn.
   *
   * @param viewerId - Người xem cần kiểm.
   * @param targetId - Người cần xem hồ sơ.
   * @returns `true` khi hai người chung một hội thoại 1–1 không bị chặn.
   */
  async sharesDirectConversation(viewerId: string, targetId: string, db: MessagingDb = this.db()): Promise<boolean> {
    if (viewerId === targetId) return true;
    const row = await db
      .selectFrom('message_conversation_members')
      .innerJoin('message_conversations', 'message_conversations.id', 'message_conversation_members.conversation_id')
      .select(sql<number>`1`.as('value'))
      .where((eb) => eb.and([
        eb('message_conversation_members.user_id', '=', viewerId),
        eb('message_conversations.type', '=', 1),
        sql<SqlBool>`exists (
          select 1 from message_conversation_members other_m
          where other_m.conversation_id = message_conversation_members.conversation_id
            and other_m.user_id = ${targetId}
        )`,
        sql<SqlBool>`not (exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${viewerId} and b.blocked_user_id = ${targetId})
             or (b.user_id = ${targetId} and b.blocked_user_id = ${viewerId})
        ))`,
      ]))
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * Tenant của một conversation (TENANT-1, #196) — nguồn tenant cho
   * notification tin nhắn mới. Cài đặt truy vấn ở bề mặt đọc dùng
   * chung `@giaokhoa/messaging` — repository chỉ uỷ quyền (issue #521).
   */
  async getConversationTenantId(conversationId: string): Promise<string | null> {
    return this.store.getConversationTenantId(conversationId);
  }
}
