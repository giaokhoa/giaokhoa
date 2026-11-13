/**
 * Liên hệ đã duyệt và yêu cầu kết bạn.
 *
 * Một miền của {@link MessagingRepository} (xem `messaging.ts`): nhận handle kho trung tâm qua constructor, mọi phương thức nhận handle tuỳ chọn `db` mặc định là handle gốc (khuôn S6) — facade ở `messaging.ts` giữ nguyên API public và uỷ quyền sang đây.
 */
import {
  sql,
  type SqlBool,
} from 'kysely';
import type { CentreDb } from '../client';
import {
  CONTACT_REQUEST_COLUMNS,
  type ContactRequestRow,
  type MessagingDb,
} from './messaging';

/** Liên hệ đã duyệt và yêu cầu kết bạn. */
export class MessagingContactsRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Handle gốc của miền (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }


  // --- contacts (quan hệ đã duyệt) + yêu cầu kết bạn -------------------------

  /**
   * Ghi quan hệ liên hệ ĐÃ DUYỆT ở cả hai chiều (a→b và b→a) — một
   * quan hệ được chấp nhận là hai phía theo đúng mô hình Moodle.
   */
  async addContactPair(a: string, b: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .insertInto('message_contacts')
      .values([
        { user_id: a, contact_id: b },
        { user_id: b, contact_id: a },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Gỡ quan hệ liên hệ ở cả hai chiều, đồng thời dọn mọi yêu cầu đang
   * chờ giữa hai người (quan hệ đã chấm dứt thì hàng chờ cũng hết nghĩa).
   */
  async removeContactPair(a: string, b: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .deleteFrom('message_contacts')
      .where((eb) => eb.or([
        eb.and([eb('user_id', '=', a), eb('contact_id', '=', b)]),
        eb.and([eb('user_id', '=', b), eb('contact_id', '=', a)]),
      ]))
      .execute();
    await this.deleteContactRequestsBetween(a, b, db);
  }

  /**
   * Danh bạ của user (các liên hệ đã được duyệt — quan hệ hai chiều nên
   * một hướng truy vấn là đủ). Quan hệ chặn đang hiệu lực (bất kỳ
   * chiều nào) thì hai người ẨN khỏi danh bạ của nhau theo chuẩn app
   * nhắn tin; hàng quan hệ trong DB giữ nguyên — bỏ chặn là hiện lại.
   */
  async listContacts(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('message_contacts')
      .select('contact_id as contactId')
      .where((eb) => eb.and([
        eb('user_id', '=', userId),
        sql<SqlBool>`not exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${userId} and b.blocked_user_id = message_contacts.contact_id)
             or (b.user_id = message_contacts.contact_id and b.blocked_user_id = ${userId})
        )`,
      ]))
      .execute();
    return rows.map((r) => r.contactId);
  }

  /**
   * Owner có contactId trong danh bạ đã duyệt hay không. Cổng liên lạc
   * dùng hướng (người nhận, người gửi) — vì quan hệ được duyệt tồn tại
   * ở cả hai chiều nên hướng này đúng khi và chỉ khi hai người là liên
   * hệ đã chấp nhận của nhau. Yêu cầu đang chờ KHÔNG nằm ở bảng này.
   */
  async isContact(ownerId: string, contactId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('message_contacts')
      .select('user_id')
      .where('user_id', '=', ownerId)
      .where('contact_id', '=', contactId)
      .execute();
    return rows.length > 0;
  }

  /** Tạo một yêu cầu kết bạn (trùng cặp thì bỏ qua). */
  async createContactRequest(fromId: string, toId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .insertInto('message_contact_requests')
      .values({ user_id_from: fromId, user_id_to: toId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** Một yêu cầu kết bạn theo đúng hướng (from → to), nếu đang chờ. */
  async getContactRequest(fromId: string, toId: string, db: MessagingDb = this.db()): Promise<ContactRequestRow | undefined> {
    return db
      .selectFrom('message_contact_requests')
      .select(CONTACT_REQUEST_COLUMNS)
      .where('user_id_from', '=', fromId)
      .where('user_id_to', '=', toId)
      .executeTakeFirst();
  }

  /** Xoá một yêu cầu theo hướng (from → to): chấp nhận/từ chối đều qua đây. */
  async deleteContactRequest(fromId: string, toId: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .deleteFrom('message_contact_requests')
      .where('user_id_from', '=', fromId)
      .where('user_id_to', '=', toId)
      .execute();
  }

  /** Xoá mọi yêu cầu đang chờ giữa hai người (cả hai hướng). */
  async deleteContactRequestsBetween(a: string, b: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .deleteFrom('message_contact_requests')
      .where((eb) => eb.or([
        eb.and([eb('user_id_from', '=', a), eb('user_id_to', '=', b)]),
        eb.and([eb('user_id_from', '=', b), eb('user_id_to', '=', a)]),
      ]))
      .execute();
  }

  /** Các yêu cầu ĐẾN user này đang chờ (người gửi → chờ user duyệt). */
  async listIncomingContactRequests(userId: string, db: MessagingDb = this.db()): Promise<ContactRequestRow[]> {
    return db
      .selectFrom('message_contact_requests')
      .select(CONTACT_REQUEST_COLUMNS)
      .where('user_id_to', '=', userId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Các yêu cầu user này ĐÃ GỬI đang chờ phía kia duyệt. */
  async listOutgoingContactRequests(userId: string, db: MessagingDb = this.db()): Promise<ContactRequestRow[]> {
    return db
      .selectFrom('message_contact_requests')
      .select(CONTACT_REQUEST_COLUMNS)
      .where('user_id_from', '=', userId)
      .orderBy('created_at', 'asc')
      .execute();
  }
}
