import { sql } from "kysely";
import type { CentreDb, CentreTx } from "../client";

export type SupportHandle = CentreDb | CentreTx;

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

export class SupportGrantsRepository {
  constructor(private readonly db: CentreDb) {}

  async listGrants(
    tenantId: string,
    db: SupportHandle = this.db,
  ): Promise<SupportGrantRow[]> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
  }

  async listGrantsForRecipient(
    tenantId: string,
    recipientId: string,
    db: SupportHandle = this.db,
  ): Promise<SupportGrantRow[]> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("recipient_id", "=", recipientId)
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
  }

  async findGrant(
    tenantId: string,
    id: string,
    db: SupportHandle = this.db,
  ): Promise<SupportGrantRow | undefined> {
    return db
      .selectFrom("support_grants")
      .select(GRANT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async createGrant(
    data: {
      tenantId: string;
      recipientId: string;
      createdBy: string;
      scopes: string[];
      expiresAt: Date;
      reason: string;
    },
    db: SupportHandle = this.db,
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

  async revokeGrant(
    tenantId: string,
    grantId: string,
    actorId: string,
    db: SupportHandle = this.db,
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

  async findActiveGrant(
    tenantId: string,
    recipientId: string,
    scope: string,
    db: SupportHandle = this.db,
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

  async appendAudit(
    data: {
      tenantId: string;
      grantId: string | null;
      actorId: string;
      action: string;
      scope: string | null;
    },
    db: SupportHandle = this.db,
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

  async listAudit(
    tenantId: string,
    db: SupportHandle = this.db,
  ): Promise<SupportAuditRow[]> {
    return db
      .selectFrom("support_access_events")
      .select(AUDIT_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(200)
      .execute();
  }

  async listClasses(tenantId: string, db: SupportHandle = this.db) {
    return db
      .selectFrom("classes")
      .select(["id", "name", "code", "status"])
      .where("tenant_id", "=", tenantId)
      .orderBy("name")
      .limit(100)
      .execute();
  }

  async listCourses(tenantId: string, db: SupportHandle = this.db) {
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
      .limit(100)
      .execute();
  }
}
