/**
 * Thông báo trong ứng dụng (gộp theo loại × nguồn × ngày) và nhật ký dispatch qua kênh.
 *
 * Một miền của {@link MessagingRepository} (xem `messaging.ts`): nhận handle kho trung tâm qua constructor, mọi phương thức nhận handle tuỳ chọn `db` mặc định là handle gốc (khuôn S6) — facade ở `messaging.ts` giữ nguyên API public và uỷ quyền sang đây.
 */
import {
  sql,
  type Expression,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import type { CentreDb } from '../client';
import {
  DISPATCH_LOG_COLUMNS,
  NOTIFICATION_COLUMNS,
  NOTIFICATION_TIME_ZONE,
  dispatchLogInsertValues,
  notificationInsertValues,
  type DispatchLogRow,
  type MessagingDb,
  type NewDispatchLog,
  type NewNotification,
  type NotificationGroupAggregateRow,
  type NotificationItemsOptions,
  type NotificationRow,
} from './messaging';

/** Thông báo trong ứng dụng (gộp theo loại × nguồn × ngày) và nhật ký dispatch qua kênh. */
export class MessagingNotificationsRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Handle gốc của miền (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }


  // --- notification ------------------------------------------------------------
  // Phạm vi tenant của các đường ĐỌC/GHI phía user (TENANT-1, #196 —
  // lọc tầng ứng dụng, lớp phòng thủ thứ nhất; RLS fail-closed là lưới
  // cứng phía sau) do tầng service truyền tường minh qua tham số
  // `tenantId` cuối mỗi method: đang trong ngữ cảnh một tenant → chỉ
  // notification của tenant đó; ngữ cảnh platform hoặc đường nền
  // (consumer quét xuyên tenant) → undefined = không lọc thêm ở tầng
  // này. Repository không đọc ALS (xem ghi chú đầu file).

  /**
   * Chèn notification trong ứng dụng.
   */
  async insertNotification(v: NewNotification, db: MessagingDb = this.db()): Promise<NotificationRow> {
    return db
      .insertInto('notifications')
      .values(notificationInsertValues(v))
      .returning(NOTIFICATION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Số notification chưa đọc (đếm bằng count(*) ở DB).
   */
  async countUnreadNotifications(userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    const row = await db
      .selectFrom('notifications')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('time_read', 'is', null),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .executeTakeFirst();
    return row?.value ?? 0;
  }

  /**
   * Đánh dấu một notification đã đọc.
   */
  async markNotificationRead(id: string, userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .updateTable('notifications')
      .set({ time_read: new Date() })
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('id', '=', id),
          eb('user_id_to', '=', userIdTo),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length > 0;
  }

  /**
   * Đánh dấu mọi notification đã đọc.
   */
  async markAllNotificationsRead(userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    const rows = await db
      .updateTable('notifications')
      .set({ time_read: new Date() })
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('time_read', 'is', null),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length;
  }


  /**
   * Danh sách GỘP của trung tâm thông báo v2 (issue #51): tổng hợp
   * theo (loại × nguồn × ngày) ngay trong SQL — nguồn là `contextUrl`
   * chuẩn hoá ('' khi không có), ngày là ngày lịch Asia/Ho_Chi_Minh. Sắp
   * xếp theo hoạt động mới nhất; phân trang keyset trên cặp
   * (max(created_at), max(id)) của dòng gộp qua mệnh đề HAVING, nên
   * không trang nào phải tải toàn bộ lịch sử về mới gộp được.
   *
   * Ba điểm ghép đoạn động (danh sách IN của `eventTypes`, mệnh đề
   * WHERE, mệnh đề HAVING) dùng `sql.join` của Kysely theo khuôn
   * T-11: tầng gọi chỉ đẩy đoạn khi danh sách tương ứng KHÔNG rỗng
   * (danh sách loại rỗng = không lọc; HAVING rỗng = không có mệnh
   * đề HAVING), và biểu thức con `latestIdExpr` mang tham số của
   * cursor nằm đúng vị trí của nó trong HAVING khi ghép.
   */
  async listNotificationGroups(userIdTo: string, opts: {
    eventTypes?: string[];
    unreadOnly?: boolean;
    cursor?: { latestAt: Date; latestId: string };
    limit: number;
  }, tenantId?: string, db: MessagingDb = this.db()): Promise<NotificationGroupAggregateRow[]> {
    const where: RawBuilder<unknown>[] = [sql`user_id_to = ${userIdTo}`];
    if (tenantId !== undefined) where.push(sql`tenant_id = ${tenantId}`);
    if (opts.eventTypes && opts.eventTypes.length > 0) {
      where.push(sql`event_type in (${sql.join(opts.eventTypes.map((t) => sql`${t}`), sql`, `)})`);
    }
    // Postgres không có max(uuid): id của mục mới nhất lấy bằng array_agg sắp xếp theo (created_at, id) giảm dần — cùng thứ tự với neo keyset (max(created_at), id mới nhất).
    const latestIdExpr = sql`(array_agg(id order by created_at desc, id desc))[1]`;
    const having: RawBuilder<unknown>[] = [];
    if (opts.unreadOnly) having.push(sql`count(*) filter (where time_read is null) > 0`);
    if (opts.cursor) {
      having.push(sql`(max(created_at), ${latestIdExpr}) < (${opts.cursor.latestAt}::timestamptz, ${opts.cursor.latestId}::uuid)`);
    }
    const query = sql<NotificationGroupAggregateRow>`
      select
        event_type as "eventType",
        component as "component",
        coalesce(nullif(context_url, ''), '') as "sourceKey",
        to_char((created_at at time zone '${sql.raw(NOTIFICATION_TIME_ZONE)}')::date, 'YYYY-MM-DD') as "day",
        count(*)::int as "count",
        (count(*) filter (where time_read is null))::int as "unreadCount",
        max(created_at) as "latestAt",
        ${latestIdExpr}::text as "latestId"
      from notifications
      where ${sql.join(where, sql` and `)}
      group by event_type, component, coalesce(nullif(context_url, ''), ''), (created_at at time zone '${sql.raw(NOTIFICATION_TIME_ZONE)}')::date
      ${having.length > 0 ? sql`having ${sql.join(having, sql` and `)}` : sql``}
      order by max(created_at) desc, ${latestIdExpr} desc
      limit ${opts.limit}
    `;
    const res = await query.execute(db);
    return res.rows;
  }


  /** Lấy các notification theo đúng tập id (điểm neo `latest` của các dòng gộp). */
  async listNotificationsByIds(ids: string[], tenantId?: string, db: MessagingDb = this.db()): Promise<NotificationRow[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom('notifications')
      .select(NOTIFICATION_COLUMNS)
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [eb('id', 'in', ids)];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .execute();
  }


  /**
   * Danh sách PHẲNG của trung tâm v2: phân trang keyset theo
   * (createdAt, id) giảm dần; bộ lọc (loại × nguồn × ngày) mở chi
   * tiết đúng một dòng gộp, `day` so theo ngày lịch Asia/Ho_Chi_Minh như
   * khoá gộp để hai đường không bao giờ lệch nhau.
   */
  async listNotificationItems(userIdTo: string, opts: NotificationItemsOptions, tenantId?: string, db: MessagingDb = this.db()): Promise<NotificationRow[]> {
    return db
      .selectFrom('notifications')
      .select(NOTIFICATION_COLUMNS)
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [eb('user_id_to', '=', userIdTo)];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        if (opts.eventType) conds.push(eb('event_type', '=', opts.eventType));
        if (opts.eventTypes && opts.eventTypes.length > 0) conds.push(eb('event_type', 'in', opts.eventTypes));
        if (opts.source === null) {
          conds.push(sql<SqlBool>`coalesce(nullif(context_url, ''), '') = ''`);
        } else if (typeof opts.source === 'string') {
          conds.push(eb('context_url', '=', opts.source));
        }
        if (opts.day) {
          conds.push(sql<SqlBool>`to_char((created_at at time zone '${sql.raw(NOTIFICATION_TIME_ZONE)}')::date, 'YYYY-MM-DD') = ${opts.day}`);
        }
        if (opts.unreadOnly) conds.push(eb('time_read', 'is', null));
        if (opts.cursor) {
          conds.push(sql<SqlBool>`(created_at, id) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id}::uuid)`);
        }
        return eb.and(conds);
      })
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit)
      .execute();
  }


  /**
   * Đánh dấu đã đọc HÀNG LOẠT theo khoá gộp (loại × nguồn × ngày)
   * của trung tâm v2: chỉ các mục chưa đọc thuộc đúng khoá mới đổi.
   */
  async markNotificationGroupRead(userIdTo: string, key: { eventType: string; sourceKey: string; day: string }, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    const rows = await db
      .updateTable('notifications')
      .set({ time_read: new Date() })
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('event_type', '=', key.eventType),
          eb('time_read', 'is', null),
          sql<SqlBool>`coalesce(nullif(context_url, ''), '') = ${key.sourceKey}`,
          sql<SqlBool>`to_char((created_at at time zone '${sql.raw(NOTIFICATION_TIME_ZONE)}')::date, 'YYYY-MM-DD') = ${key.day}`,
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length;
  }


  /** Xoá MỘT notification của đúng chủ sở hữu; false khi không tồn tại hoặc không phải của họ. */
  async deleteNotification(id: string, userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .deleteFrom('notifications')
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('id', '=', id),
          eb('user_id_to', '=', userIdTo),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length > 0;
  }


  /** Dọn mọi notification ĐÃ ĐỌC của user (trung tâm v2); trả số mục đã xoá. */
  async deleteReadNotifications(userIdTo: string, tenantId?: string, db: MessagingDb = this.db()): Promise<number> {
    const rows = await db
      .deleteFrom('notifications')
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('time_read', 'is not', null),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length;
  }


  /**
   * Còn notification CHƯA ĐỌC của (user, loại sự kiện, ngữ cảnh) hay
   * không — căn cứ gộp thông báo tin nhắn mới theo conversation của
   * consumer thông báo sự kiện ở worker: còn một bản chưa đọc thì
   * các tin tiếp theo trong cùng conversation không sinh thêm bản
   * nữa.
   */
  async hasUnreadNotification(userIdTo: string, eventType: string, contextUrl: string, db: MessagingDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('notifications')
      .select('id')
      .where('user_id_to', '=', userIdTo)
      .where('event_type', '=', eventType)
      .where('context_url', '=', contextUrl)
      .where('time_read', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }


  /**
   * Thông tin tối thiểu của một grade item để consumer thông báo điểm
   * mới quyết định có phát hay không (bỏ qua tổng khoá/tổng hạng mục/
   * item công thức và item bị ẩn) và dựng nội dung không chứa điểm số.
   */
  async getGradeItemNotifyInfo(itemId: string, db: MessagingDb = this.db()): Promise<{ itemType: string; itemName: string; hidden: boolean; courseId: string } | undefined> {
    return db
      .selectFrom('grade_items')
      .select(['item_type as itemType', 'item_name as itemName', 'hidden', 'course_id as courseId'])
      .where('id', '=', itemId)
      .executeTakeFirst();
  }


  /**
   * Điểm của user trên item có đang bị ẩn với chính user đó không
   * (grade_grades.hidden — điểm bị giáo viên ẩn thì học sinh không
   * nhận thông báo điểm mới).
   */
  async isGradeHiddenForUser(itemId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('grade_grades')
      .select('hidden')
      .where('item_id', '=', itemId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row?.hidden ?? false;
  }


  /** Tên đầy đủ của khoá học để dựng nội dung thông báo. */
  async getCourseFullName(courseId: string, db: MessagingDb = this.db()): Promise<string | undefined> {
    const row = await db
      .selectFrom('course')
      .select('full_name as fullName')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.fullName;
  }


  // --- thông tin hoạt động cho consumer NB-1 (issue #174) ---------------------
  // Đọc thẳng bảng assignments/quizzes/course_modules/course qua barrel
  // schema, cùng kỷ luật "đọc bảng dùng chung, không import module
  // khác" như các helper phía trên. Trạng thái hiển thị của module
  // (visible/deletionInProgress) + của khoá là cổng phát: học sinh
  // không thấy hoạt động thì không nhận thông báo về nó — cùng ngữ
  // nghĩa worker nhắc hạn dùng cho quiz.

  /**
   * Thông tin tối thiểu của một bài tập để consumer quyết định phát
   * assignment_assigned/assignment_submitted/assignment_returned và
   * dựng nội dung: tên, khoá, trạng thái hiển thị của khoá + module.
   */
  async getAssignmentNotifyInfo(assignmentId: string, db: MessagingDb = this.db()): Promise<{
    name: string; courseId: string; courseVisible: boolean; cmVisible: boolean | null; cmDeletionInProgress: boolean | null;
  } | undefined> {
    return db
      .selectFrom('assignments')
      .innerJoin('course', 'course.id', 'assignments.course')
      .leftJoin('course_modules', 'course_modules.id', 'assignments.cm_id')
      .select([
        'assignments.name as name',
        'assignments.course as courseId',
        'course.visible as courseVisible',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('assignments.id', '=', assignmentId)
      .executeTakeFirst();
  }


  /** Như trên cho một quiz (assignment → quiz_available / quiz_attempt_finished). */
  async getPinNotifyInfo(pinId: string, db: MessagingDb = this.db()): Promise<{
    name: string; courseId: string; courseVisible: boolean; cmVisible: boolean | null; cmDeletionInProgress: boolean | null;
  } | undefined> {
    return db
      .selectFrom('exam_pins')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .innerJoin('course', 'course.id', 'exam_pins.course_id')
      .leftJoin('course_modules', 'course_modules.id', 'exam_pins.cm_id')
      .select([
        sql<string>`coalesce(exam_pins.name, exam_versions.name)`.as('name'),
        'exam_pins.course_id as courseId',
        'course.visible as courseVisible',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('exam_pins.id', '=', pinId)
      .executeTakeFirst();
  }


  /**
   * Số bài nộp của một bài tập đang CHỜ CHẤM tại thời điểm gọi: bản
   * nộp ở trạng thái submitted mà gói chấm của đúng lần nộp đó chưa
   * được trả bài (assign_grades khớp attempt_number, status khác
   * 'released' hoặc chưa có gói chấm) — con số trong nội dung thông
   * báo gộp assignment_submitted cho giáo viên (P5, issue #174).
   */
  async countAssignmentSubmissionsAwaitingGrading(assignmentId: string, db: MessagingDb = this.db()): Promise<number> {
    const rows = await db
      .selectFrom('assign_submissions')
      .leftJoin('assign_grades', (join) => join
        .onRef('assign_grades.assignment_id', '=', 'assign_submissions.assignment_id')
        .onRef('assign_grades.user_id', '=', 'assign_submissions.user_id')
        .onRef('assign_grades.attempt_number', '=', 'assign_submissions.attempt_number'))
      .select('assign_submissions.id as id')
      .where((eb) => eb.and([
        eb('assign_submissions.assignment_id', '=', assignmentId),
        eb('assign_submissions.status', '=', 'submitted'),
        eb.or([
          eb('assign_grades.id', 'is', null),
          eb('assign_grades.status', '<>', 'released'),
        ]),
      ]))
      .execute();
    return rows.length;
  }


  /** Số lượt làm của một lần ghim đang ở trạng thái cần chấm tay (không tính lượt preview của giáo viên). */
  async countPinAttemptsNeedingGrading(pinId: string, db: MessagingDb = this.db()): Promise<number> {
    const rows = await db
      .selectFrom('exam_attempts')
      .select('id')
      .where('pin_id', '=', pinId)
      .where('state', '=', 'needsgrading')
      .where('preview', '=', false)
      .execute();
    return rows.length;
  }


  /**
   * Bản notification CHƯA ĐỌC đại diện cho một (user, loại, ngữ cảnh)
   * — căn cứ GỘP của NB-1 như hasUnreadNotification nhưng trả cả dòng
   * để consumer CẬP NHẬT nội dung (số lượng chờ chấm mới nhất) thay vì
   * sinh bản mới (P5: một thông báo gộp cập nhật số lượng).
   */
  async getUnreadNotification(userIdTo: string, eventType: string, contextUrl: string, db: MessagingDb = this.db()): Promise<NotificationRow | undefined> {
    return db
      .selectFrom('notifications')
      .select(NOTIFICATION_COLUMNS)
      .where('user_id_to', '=', userIdTo)
      .where('event_type', '=', eventType)
      .where('context_url', '=', contextUrl)
      .where('time_read', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }


  /** Cập nhật nội dung một notification đang tồn tại (chỉ dùng cho bản gộp chưa đọc của NB-1). */
  async updateNotificationContent(id: string, subject: string, fullMessage: string, db: MessagingDb = this.db()): Promise<void> {
    await db
      .updateTable('notifications')
      .set({ subject, full_message: fullMessage, small_message: fullMessage.slice(0, 200) })
      .where('id', '=', id)
      .execute();
  }


  /** Tenant sở hữu khoá học (TENANT-1, #196) — nguồn tenant cho notification/dữ liệu phát sinh từ khoá. */
  async getCourseTenantId(courseId: string, db: MessagingDb = this.db()): Promise<string | null> {
    const row = await db
      .selectFrom('course')
      .select('tenant_id as tenantId')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.tenantId ?? null;
  }

  /**
   * Tenant mặc định của một user (TENANT-1, #196) — cùng luật với
   * `TenantsService.resolveDefaultTenant` (TENANT-0): membership active
   * duy nhất → tenant đó; nhiều tenant → tenant trường đầu tiên;
   * không có → tenant platform (Trang chính). Dùng làm nguồn tenant
   * cuối cùng cho notification khi nơi phát không gắn đối tượng nguồn
   * thuộc tenant nào (bảng users KHÔNG có cột tenant — tư cách thành
   * viên mới là nguồn sự thật).
   */
  async getUserDefaultTenantId(userId: string, db: MessagingDb = this.db()): Promise<string | null> {
    const rows = await db
      .selectFrom('tenant_memberships')
      .innerJoin('tenants', 'tenants.id', 'tenant_memberships.tenant_id')
      .select(['tenant_memberships.tenant_id as tenantId', 'tenants.kind as kind'])
      .where('tenant_memberships.user_id', '=', userId)
      .where('tenant_memberships.status', '=', 'active')
      .where('tenants.status', '=', 'active')
      .execute();
    const distinct = [...new Map(rows.map((r) => [r.tenantId, r])).values()];
    if (distinct.length === 1) return distinct[0].tenantId;
    if (distinct.length > 1) {
      const nonPlatform = distinct.find((r) => r.kind !== 'platform');
      if (nonPlatform) return nonPlatform.tenantId;
    }
    const zero = await db
      .selectFrom('tenants')
      .select('id')
      .where('kind', '=', 'platform')
      .executeTakeFirst();
    return zero?.id ?? null;
  }


  /**
   * Ghi nhật ký một lần dispatch notification qua kênh.
   */
  async insertDispatchLog(v: NewDispatchLog, db: MessagingDb = this.db()): Promise<DispatchLogRow> {
    const row = await db
      .insertInto('notification_dispatch_log')
      .values(dispatchLogInsertValues(v))
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning(DISPATCH_LOG_COLUMNS)
      .executeTakeFirst();
    if (row) return row as DispatchLogRow;
    // Trùng dedupe_key: đọc lại dòng đã ghi của lần dispatch trước —
    // giữ đúng đường đọc của bản cũ (qua handle gốc, không qua tx).
    const existing = await this.handle
      .selectFrom('notification_dispatch_log')
      .select(DISPATCH_LOG_COLUMNS)
      .where('dedupe_key', '=', v.dedupeKey!)
      .executeTakeFirstOrThrow();
    return existing as DispatchLogRow;
  }

  /**
   * Nhật ký dispatch (kiểm chứng gửi).
   */
  async listDispatchLog(userId: string, db: MessagingDb = this.db()): Promise<DispatchLogRow[]> {
    return db
      .selectFrom('notification_dispatch_log')
      .select(DISPATCH_LOG_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }
}
