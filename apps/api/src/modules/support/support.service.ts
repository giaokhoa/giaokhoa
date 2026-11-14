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
import { SpaceRoutingError } from "../../db/routing/space-connection-resolver";
import { TenantsService } from "../tenants/tenants.service";
import { UsersService } from "../users/users.service";
import { TenantContextService } from "../tenants/tenant-context.service";
import { tenantAls } from "../tenants/tenant-als";

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;

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

@Injectable()
export class SupportService {
  constructor(
    private readonly repo: SupportGrantsRepository,
    private readonly tenants: TenantsService,
    private readonly tenantContext: TenantContextService,
    private readonly spaceDb: SpaceDatabaseService,
    private readonly users: UsersService,
  ) {}

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
    await this.tenants.assertTenantManager(actorId, tenantId);
    return tenantId;
  }

  async create(
    actorId: string,
    dto: CreateSupportGrant,
  ): Promise<SupportGrant> {
    const tenantId = await this.requireCentreManager(actorId);
    const recipient = await tenantAls.run(
      { platform: true },
      () => this.users.getByIdOrUndefined(dto.recipientId),
    );
    if (
      !recipient || recipient.deleted || recipient.suspended ||
      !(await this.tenants.isPlatformSupportMember(dto.recipientId))
    ) {
      throw new BadRequestException({
        message: "Recipient must be an active platform member",
        code: "support.invalid_recipient",
      });
    }
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

  async list(actorId: string): Promise<SupportGrant[]> {
    const tenantId = await this.requireCentreManager(actorId);
    return (await this.repo.listGrants(tenantId)).map(grantView);
  }

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

  async audit(actorId: string): Promise<SupportAuditEntry[]> {
    const tenantId = await this.requireCentreManager(actorId);
    return (await this.repo.listAudit(tenantId)).map(auditView);
  }

  private async resolveCentre(slug: string): Promise<string> {
    if (!SLUG_PATTERN.test(slug))
      throw new BadRequestException({
        message: "Invalid slug",
        code: "support.invalid_centre",
      });
    let target;
    try {
      target = await this.spaceDb.resolveTarget(slug);
    } catch (error) {
      if (error instanceof SpaceRoutingError && error.code === "space_routing.shared_not_supported") {
        throw new ForbiddenException({
          message: "Shared centre databases are no longer supported",
          code: "space_routing.shared_not_supported",
        });
      }
      throw error;
    }
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

  async access(actorId: string, slug: string, scope: SupportScope) {
    const tenantId = await this.resolveCentre(slug);
    return this.spaceDb.withSpaceKysely(
      slug,
      async (db) => {
        const staffActive = await this.tenants.isPlatformSupportMember(actorId);
        const grant = staffActive
          ? await this.repo.findActiveGrant(tenantId, actorId, scope, db)
          : undefined;
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

  async myAccess(actorId: string, slug: string): Promise<SupportGrant[]> {
    if (!(await this.tenants.isPlatformSupportMember(actorId))) {
      throw new ForbiddenException({
        message: "Active platform membership required for support",
        code: "support.staff_required",
      });
    }
    const tenantId = await this.resolveCentre(slug);
    return this.spaceDb.withSpaceKysely(
      slug,
      async (db) =>
        (await this.repo.listGrantsForRecipient(tenantId, actorId, db))
          .map(grantView),
      { tenantId },
    );
  }
}
