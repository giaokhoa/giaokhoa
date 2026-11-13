/**
 * Repository của quyền hỗ trợ hữu hạn trong kho của từng trung tâm.
 *
 * Mọi phép đọc/ghi chỉ nhận handle Kysely đã được gắn tenant qua
 * TenantAwarePool; repository không tự chọn kho, đặt GUC hay cấp quyền.
 * Danh sách grant, trạng thái thu hồi và audit nằm cùng kho và cùng
 * chính sách RLS của trung tâm. Audit không lưu dữ liệu nghiệp vụ.
 */
import { sql } from "kysely";
import type { CentreDb, CentreTx } from "../client";

export type SupportHandle = CentreDb | CentreTx;

/** Hình dạng dòng grant trả về biên repository, giữ thời gian kiểu Date. */
export interface SupportGrantRow {
  id: string;
  tenantId: string;
  recipientId: string;
  createdBy: string;
  scopes: string[];
  reason: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt: Date;
}

/** Hình dạng một dòng audit chỉ chứa metadata cần cho trung tâm. */
export interface SupportAuditRow {
  id: string;
  tenantId: string;
  grantId: string | null;
  actorId: string;
  action: string;
  scope: string | null;
  createdAt: Date;
}

const GRANT_COLUMNS = [
  "id",
  "tenant_id as tenantId",
  "recipient_id as recipientId",
  "created_by as createdBy",
  "scopes",
  "reason",
  "expires_at as expiresAt",
  "revoked_at as revokedAt",
  "revoked_by as revokedBy",
  "created_at as createdAt",
] as const;

const AUDIT_COLUMNS = [
  "id",
  "tenant_id as tenantId",
  "grant_id as grantId",
  "actor_id as actorId",
  "action",
  "scope",
  "created_at as createdAt",
] as const;

/** Số dòng tối đa của các danh sách hỗ trợ (grant, lớp, khoá học) — giới hạn chặn, không phân trang (S21). */
const SUPPORT_LIST_LIMIT = 100;
/** Số dòng tối đa của nhật ký truy cập hỗ trợ (S21). */
const SUPPORT_AUDIT_LIMIT = 200;

/**
 * Tầng truy cập thuần: caller sở hữu transaction, cấp tenant và handle,
 * tránh một transaction chạm nhiều kho.
 */
export class SupportGrantsRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Handle gốc của kho trung tâm (đã gắn tenant qua TenantAwarePool). */
  private db(): CentreDb {
    return this.handle;
  }

  /** Trả danh sách grant của đúng tenant hiệu lực (kể cả hết hạn/thu hồi). */
  async listGrants(
    tenantId: string,
    db: SupportHandle = this.db(),
  ): Promise<SupportGrantRow[]> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(SUPPORT_LIST_LIMIT)
      .execute();
  }

  /**
   * Tra các grant của người nhận TRƯỚC khi giới hạn danh sách.
   * Không lọc sau LIMIT tenant vì nhiều grant của nhân sự khác có
   * thể che mất grant còn hiệu lực ở trang sau.
   */
  async listGrantsForRecipient(
    tenantId: string,
    recipientId: string,
    db: SupportHandle = this.db(),
  ): Promise<SupportGrantRow[]> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("recipient_id", "=", recipientId)
      .orderBy("created_at", "desc")
      .limit(SUPPORT_LIST_LIMIT)
      .execute();
  }

  /** Tìm grant theo id và tenant; không lộ grant của tenant khác. */
  async findGrant(
    tenantId: string,
    id: string,
    db: SupportHandle = this.db(),
  ): Promise<SupportGrantRow | undefined> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** Lưu grant vừa qua kiểm chứng của service; UUIDv7 do DB cấp. */
  async createGrant(
    data: {
      tenantId: string;
      recipientId: string;
      createdBy: string;
      scopes: string[];
      expiresAt: Date;
      reason: string;
    },
    db: SupportHandle = this.db(),
  ): Promise<SupportGrantRow> {
    return db
      .insertInto("support_grants")
      .values({
        tenant_id: data.tenantId,
        recipient_id: data.recipientId,
        created_by: data.createdBy,
        scopes: data.scopes,
        expires_at: data.expiresAt,
        reason: data.reason,
      })
      .returning(GRANT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Thu hồi nguyên tử, chỉ trên grant chưa thu hồi của tenant hiện tại.
   * Không xoá dòng để audit luôn gắn được người nhận/phạm vi ban đầu.
   */
  async revokeGrant(
    tenantId: string,
    grantId: string,
    actorId: string,
    db: SupportHandle = this.db(),
  ): Promise<SupportGrantRow | undefined> {
    return db
      .updateTable("support_grants")
      .set({
        revoked_at: new Date(),
        revoked_by: actorId,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", grantId)
      .where("revoked_at", "is", null)
      .returning(GRANT_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Chỉ grant của người nhận, tenant và thao tác đang hiệu lực tại
   * thời gian DB mới được chọn; không dựa trên claim hoặc cache phiên.
   */
  async findActiveGrant(
    tenantId: string,
    recipientId: string,
    scope: string,
    db: SupportHandle = this.db(),
  ): Promise<SupportGrantRow | undefined> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("recipient_id", "=", recipientId)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", sql<Date>`now()`)
      .where("scopes", "@>", sql<string[]>`ARRAY[${scope}]::text[]`)
      .orderBy("expires_at", "asc")
      .limit(1)
      .executeTakeFirst();
  }

  /** Ghi kết quả kiểm quyền mà không lưu dữ liệu riêng hoặc bí mật. */
  async appendAudit(
    data: {
      tenantId: string;
      grantId: string | null;
      actorId: string;
      action: string;
      scope: string | null;
    },
    db: SupportHandle = this.db(),
  ): Promise<void> {
    await db
      .insertInto("support_access_events")
      .values({
        tenant_id: data.tenantId,
        grant_id: data.grantId,
        actor_id: data.actorId,
        action: data.action,
        scope: data.scope,
      })
      .executeTakeFirstOrThrow();
  }

  /** Audit của riêng tenant, giới hạn số dòng để không lộ lịch sử khác. */
  async listAudit(
    tenantId: string,
    db: SupportHandle = this.db(),
  ): Promise<SupportAuditRow[]> {
    return db
      .selectFrom("support_access_events")
      .select(AUDIT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(SUPPORT_AUDIT_LIMIT)
      .execute();
  }

  /** Chiếu các lớp trong tenant; không xuất mã tham gia hay danh sách học viên. */
  async listClasses(tenantId: string, db: SupportHandle = this.db()) {
    return db
      .selectFrom("classes")
      .select(["id", "name", "code", "status"])
      .where("tenant_id", "=", tenantId)
      .orderBy("name")
      .limit(SUPPORT_LIST_LIMIT)
      .execute();
  }

  /** Chiếu các khoá học trong tenant; không xuất bài làm, điểm hoặc nội dung. */
  async listCourses(tenantId: string, db: SupportHandle = this.db()) {
    return db
      .selectFrom("course")
      .select([
        "id",
        "full_name as fullName",
        "short_name as shortName",
        "visible",
      ])
      .where("tenant_id", "=", tenantId)
      .orderBy("full_name")
      .limit(SUPPORT_LIST_LIMIT)
      .execute();
  }
}
