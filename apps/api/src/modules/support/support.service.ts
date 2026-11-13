/**
 * Nghiệp vụ grant hỗ trợ có hạn của từng trung tâm (issue #19).
 * Quản trị trung tâm cấp/thu hồi với tenant của phiên nghiệp vụ.
 * Nhân sự platform chỉ truy cập route hỗ trợ riêng: mỗi request đọc
 * lại grant trong kho đích, ghi audit và chỉ trả hình chiếu đã cho phép.
 * Không chuyển audience, không login-as hoặc nâng quyền ngầm.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateSupportGrant,
  SupportAuditEntry,
  SupportGrant,
  SupportScope,
} from "@giaokhoa/contracts";
import {
  SupportGrantsRepository,
  type SupportGrantRow,
  type SupportAuditRow,
} from "@giaokhoa/db/repositories/support-grants";
import { SpaceDatabaseService } from "../../db/routing/space-database.service";
import { TenantsService } from "../tenants/tenants.service";
import { TenantContextService } from "../tenants/tenant-context.service";
import { tenantAls } from "../tenants/tenant-als";

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;

/** Chiếu grant ra contract, trạng thái luôn được tính lại từ đồng hồ. */
function grantView(row: SupportGrantRow): SupportGrant {
  return {
    id: row.id,
    tenantId: row.tenantId,
    recipientId: row.recipientId,
    createdBy: row.createdBy,
    scopes: row.scopes as SupportScope[],
    reason: row.reason,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy,
    createdAt: row.createdAt.toISOString(),
    status: row.revokedAt
      ? "revoked"
      : row.expiresAt.getTime() <= Date.now()
        ? "expired"
        : "active",
  };
}

/** Audit chỉ chiếu định danh/phạm vi/kết quả; không gửi dữ liệu riêng. */
function auditView(row: SupportAuditRow): SupportAuditEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    grantId: row.grantId,
    actorId: row.actorId,
    action: row.action as SupportAuditEntry["action"],
    scope: row.scope as SupportScope | null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Điều phối cấp, thu hồi, đọc audit và kiểm grant hỗ trợ theo request. */
@Injectable()
export class SupportService {
  constructor(
    private readonly repo: SupportGrantsRepository,
    private readonly tenants: TenantsService,
    private readonly tenantContext: TenantContextService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}

  /**
   * Không nhận tenantId do client chỉ định: chỉ chủ của tenant center
   * hiệu lực mới cấp/thu hồi hoặc xem grant. Quyền phải là gán vai
   * thật ở cây tenant, không phải quyền site-admin trên platform.
   * @param actorId - Danh tính nghiệp vụ đã qua guard.
   * @returns Tenant ID thuộc trung tâm hiện thời.
   * @throws support.centre_required hoặc access.capability_denied.
   */
  private async requireCentreManager(actorId: string): Promise<string> {
    const tenantId = this.tenantContext.currentTenantId();
    if (!tenantId)
      throw new ForbiddenException({
        message: "Centre context required",
        code: "support.centre_required",
      });
    const tenant = await this.tenants.getTenant(tenantId);
    if (!tenant || tenant.kind !== "center" || tenant.status !== "active") {
      throw new ForbiddenException({
        message: "Active centre required",
        code: "support.centre_required",
      });
    }
    // Dùng đúng cổng quản trị đã chốt của TenantsService: quyền
    // tenant:manage hoặc chủ site-admin CỦA CHÍNH kho trung tâm,
    // với membership active và slug đối chiếu chặt tại service đó.
    await this.tenants.assertTenantManager(actorId, tenantId);
    return tenantId;
  }

  /**
   * Cấp grant tối đa 30 ngày, phạm vi đóng đã được Zod kiểm.
   * Grant và vết cấp cùng commit hoặc cùng rollback trong kho A.
   * @param actorId - Quản trị của trung tâm.
   * @param dto - Người nhận, thao tác, lý do và hạn cuối.
   * @returns Grant được cấp.
   */
  async create(
    actorId: string,
    dto: CreateSupportGrant,
  ): Promise<SupportGrant> {
    const tenantId = await this.requireCentreManager(actorId);
    const expiresAt = new Date(dto.expiresAt);
    const remaining = expiresAt.getTime() - Date.now();
    if (remaining <= 0 || remaining > MAX_DURATION_MS) {
      throw new BadRequestException({
        message: "Support grant must expire within 30 days",
        code: "support.invalid_expiry",
      });
    }
    const row = await this.spaceDb.routedKysely
      .transaction()
      .execute(async (tx) => {
        const created = await this.repo.createGrant(
          {
            tenantId,
            createdBy: actorId,
            recipientId: dto.recipientId,
            scopes: dto.scopes,
            reason: dto.reason,
            expiresAt,
          },
          tx,
        );
        await this.repo.appendAudit(
          {
            tenantId,
            grantId: created.id,
            actorId,
            action: "grant_created",
            scope: null,
          },
          tx,
        );
        return created;
      });
    return grantView(row);
  }

  /** Liệt kê cả grant đã thu hồi/hết hạn, chỉ trong tenant của chủ. */
  async list(actorId: string): Promise<SupportGrant[]> {
    const tenantId = await this.requireCentreManager(actorId);
    return (await this.repo.listGrants(tenantId)).map(grantView);
  }

  /**
   * Thu hồi nguyên tử cùng audit; không xoá lịch sử và không đổi
   * token của nhân sự platform vì cổng sử dụng luôn đọc DB mới.
   */
  async revoke(actorId: string, grantId: string): Promise<SupportGrant> {
    const tenantId = await this.requireCentreManager(actorId);
    const row = await this.spaceDb.routedKysely
      .transaction()
      .execute(async (tx) => {
        const revoked = await this.repo.revokeGrant(
          tenantId,
          grantId,
          actorId,
          tx,
        );
        if (!revoked)
          throw new ConflictException({
            message: "Grant absent or already revoked",
            code: "support.grant_not_active",
          });
        await this.repo.appendAudit(
          {
            tenantId,
            grantId: revoked.id,
            actorId,
            action: "grant_revoked",
            scope: null,
          },
          tx,
        );
        return revoked;
      });
    return grantView(row);
  }

  /** Lịch sử các quyết định hỗ trợ chỉ của tenant trung tâm hiện hành. */
  async audit(actorId: string): Promise<SupportAuditEntry[]> {
    const tenantId = await this.requireCentreManager(actorId);
    return (await this.repo.listAudit(tenantId)).map(auditView);
  }

  /**
   * Phân giải slug qua control plane, đọc định danh tenant trong
   * ngữ cảnh vận hành tối thiểu; mọi truy cập dữ liệu sau bước này
   * phải nạp GUC app.tenant_id bằng chính id đã phân giải.
   */
  private async resolveCentre(slug: string): Promise<string> {
    if (!SLUG_PATTERN.test(slug))
      throw new BadRequestException({
        message: "Invalid slug",
        code: "support.invalid_centre",
      });
    const target = await this.spaceDb.resolveTarget(slug);
    if (target.status !== "active")
      throw new ForbiddenException({
        message: "Centre inactive",
        code: "support.centre_inactive",
      });
    const tenant = await tenantAls.run({ platform: true }, () =>
      this.spaceDb.withSpaceKysely(slug, (db) =>
        db
          .selectFrom("tenants")
          .select(["id", "kind", "status"])
          .where("slug", "=", slug)
          .executeTakeFirst(),
      ),
    );
    if (!tenant || tenant.kind !== "center" || tenant.status !== "active") {
      throw new NotFoundException({
        message: "Active centre not found",
        code: "support.centre_not_found",
      });
    }
    return tenant.id;
  }

  /**
   * Kiểm grant theo recipient/centre/scope và thời gian DB tại mỗi
   * request; audit allowed/denied được ghi kể cả khi không có grant.
   * Bị từ chối không đọc bảng nghiệp vụ, grant không cấp login-as.
   * @param actorId - Danh tính từ platform access token.
   * @param slug - Trung tâm được đăng ký.
   * @param scope - Thao tác cố định của route.
   * @throws support.access_denied nếu thiếu grant hợp lệ.
   */
  async access(actorId: string, slug: string, scope: SupportScope) {
    const tenantId = await this.resolveCentre(slug);
    return this.spaceDb.withSpaceKysely(
      slug,
      async (db) => {
        const grant = await this.repo.findActiveGrant(
          tenantId,
          actorId,
          scope,
          db,
        );
        await this.repo.appendAudit(
          {
            tenantId,
            grantId: grant?.id ?? null,
            actorId,
            action: grant ? "access_allowed" : "access_denied",
            scope,
          },
          db,
        );
        if (!grant)
          throw new ForbiddenException({
            message: "Active scoped grant required",
            code: "support.access_denied",
          });
        return scope === "classes:read"
          ? this.repo.listClasses(tenantId, db)
          : this.repo.listCourses(tenantId, db);
      },
      { tenantId },
    );
  }

  /**
   * Người nhận xem trạng thái grant của chính mình; không trả nội
   * dung nghiệp vụ hoặc grant của nhân sự khác qua bề mặt platform.
   */
  async myAccess(actorId: string, slug: string): Promise<SupportGrant[]> {
    const tenantId = await this.resolveCentre(slug);
    return this.spaceDb.withSpaceKysely(
      slug,
      async (db) =>
        (await this.repo.listGrants(tenantId, db))
          .filter((grant) => grant.recipientId === actorId)
          .map(grantView),
      { tenantId },
    );
  }
}
