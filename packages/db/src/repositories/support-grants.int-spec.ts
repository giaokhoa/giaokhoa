import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TestTenantPool, runInTestTenantContext } from "../test-support/tenant-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCentreKysely, type CentreDb } from "../client";
import {
  buildTestDatabase,
  dropTestDatabase,
  withDatabase,
} from "../test-support/build-test-database";
import { SupportGrantsRepository } from "./support-grants";

const adminUrl =
  process.env.GIAOKHOA_DB_TEST_ADMIN_URL ??
  (process.env.DATABASE_URL
    ? withDatabase(process.env.DATABASE_URL, "postgres")
    : "postgres://postgres:postgres@localhost:5432/postgres");
const TEST_DB = "giaokhoa_db_support19";
const ROLE_NAME = `giaokhoa_support_19_rls_${process.pid}`;
const ROLE_PASSWORD = "Test-only-rls-19!";

let db: CentreDb;
let repo: SupportGrantsRepository;
let rlsDb: CentreDb;
let rlsRepo: SupportGrantsRepository;
let a: string;
let b: string;
const staff = randomUUID();
const otherStaff = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();

async function grant(
  tenantId: string,
  scopes: string[],
  expiresAt: Date,
  recipientId = staff,
) {
  return repo.createGrant({
    tenantId,
    recipientId,
    createdBy: tenantId === a ? ownerA : ownerB,
    scopes,
    expiresAt,
    reason: "Kiểm tra lỗi hiển thị trong trung tâm",
  });
}

beforeAll(async () => {
  const url = await buildTestDatabase({
    adminUrl,
    database: TEST_DB,
    store: "centre",
  });
  db = createCentreKysely(new Pool({ connectionString: url }));
  repo = new SupportGrantsRepository(db);
  a = (
    await db
      .insertInto("tenants")
      .values({
        slug: "support-a-19",
        name: "Trung tâm A",
        kind: "center",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  b = (
    await db
      .insertInto("tenants")
      .values({
        slug: "support-b-19",
        name: "Trung tâm B",
        kind: "center",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(`CREATE ROLE "${ROLE_NAME}" LOGIN PASSWORD '${ROLE_PASSWORD}'`);
    await adminPool.query(`GRANT CONNECT ON DATABASE "${TEST_DB}" TO "${ROLE_NAME}"`);
  } finally {
    await adminPool.end();
  }
  const grantPool = new Pool({ connectionString: url });
  try {
    await grantPool.query(`GRANT USAGE ON SCHEMA public TO "${ROLE_NAME}"`);
    await grantPool.query(`GRANT SELECT ON tenants TO "${ROLE_NAME}"`);
    await grantPool.query(`GRANT SELECT, INSERT, UPDATE ON support_grants, support_access_events TO "${ROLE_NAME}"`);
  } finally {
    await grantPool.end();
  }
  const roleUrl = new URL(url);
  roleUrl.username = ROLE_NAME;
  roleUrl.password = ROLE_PASSWORD;
  rlsDb = createCentreKysely(new TestTenantPool({ connectionString: roleUrl.toString() }));
  rlsRepo = new SupportGrantsRepository(rlsDb);
}, 180_000);

afterAll(async () => {
  if (rlsDb) await rlsDb.destroy().catch(() => undefined);
  if (db) await db.destroy().catch(() => undefined);
  await dropTestDatabase(adminUrl, TEST_DB);
  const adminPool = new Pool({ connectionString: adminUrl });
  try { await adminPool.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`); }
  finally { await adminPool.end(); }
});

describe("Quyền hỗ trợ hữu hạn và audit của từng trung tâm trên DB thật", () => {
  it("chính sách RLS bắt buộc ở cả grant và audit của trung tâm", async () => {
    const pool = new Pool({
      connectionString: withDatabase(adminUrl, TEST_DB),
    });
    try {
      const { rows: policies } = await pool.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('support_grants', 'support_access_events')`,
      );
      expect(policies).toHaveLength(2);
      expect(
        policies.every((row) => row.relrowsecurity && row.relforcerowsecurity),
      ).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("chỉ recipient và scope của A thấy grant còn hạn, B và thao tác ngoài phạm vi bị chặn", async () => {
    const created = await grant(
      a,
      ["classes:read"],
      new Date(Date.now() + 60_000),
    );
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect((await repo.findActiveGrant(a, staff, "classes:read"))?.id).toBe(
      created.id,
    );
    expect(
      await repo.findActiveGrant(a, staff, "courses:read"),
    ).toBeUndefined();
    expect(
      await repo.findActiveGrant(b, staff, "classes:read"),
    ).toBeUndefined();
    expect(
      await repo.findActiveGrant(a, otherStaff, "classes:read"),
    ).toBeUndefined();
    expect(await repo.findGrant(b, created.id)).toBeUndefined();
    expect(
      (await repo.listGrants(b)).some((row) => row.id === created.id),
    ).toBe(false);
  });

  it("grant hết hạn không còn hiệu lực ngay cả khi dòng vẫn tồn tại", async () => {
    const expired = await db
      .insertInto("support_grants")
      .values({
        tenant_id: a,
        recipient_id: staff,
        created_by: ownerA,
        scopes: ["courses:read"],
        reason: "Kiểm tra grant hết hạn",
        created_at: new Date(Date.now() - 60_000),
        expires_at: new Date(Date.now() - 5_000),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(
      await repo.findActiveGrant(a, staff, "courses:read"),
    ).toBeUndefined();
    expect((await repo.findGrant(a, expired.id))?.id).toBe(expired.id);
  });

  it("thu hồi có điều kiện, lần đọc kế tiếp chặn; audit A không xuất hiện ở B", async () => {
    const issued = await grant(
      a,
      ["classes:read", "courses:read"],
      new Date(Date.now() + 120_000),
    );
    const revoked = await db.transaction().execute(async (tx) => {
      const row = await repo.revokeGrant(a, issued.id, ownerA, tx);
      await repo.appendAudit(
        {
          tenantId: a,
          grantId: issued.id,
          actorId: ownerA,
          action: "grant_revoked",
          scope: null,
        },
        tx,
      );
      return row;
    });
    expect(revoked?.revokedBy).toBe(ownerA);
    expect(
      await repo.findActiveGrant(a, staff, "courses:read"),
    ).toBeUndefined();
    expect(await repo.revokeGrant(a, issued.id, ownerA)).toBeUndefined();
    expect(await repo.revokeGrant(b, issued.id, ownerB)).toBeUndefined();
    expect((await repo.listAudit(a)).map((event) => event.grantId)).toContain(
      issued.id,
    );
    expect(
      (await repo.listAudit(b)).some((event) => event.grantId === issued.id),
    ).toBe(false);
  });

  it("lọc recipient trong SQL trước LIMIT: hơn 100 grant mới của người khác không che quyền cũ", async () => {
    const target = await grant(a, ["classes:read"], new Date(Date.now() + 3_600_000));
    await db.updateTable("support_grants").set({
      created_at: new Date(Date.now() - 60_000),
    }).where("id", "=", target.id).execute();
    await db.insertInto("support_grants").values(
      Array.from({ length: 110 }, (_, index) => ({
        tenant_id: a, recipient_id: otherStaff, created_by: ownerA,
        scopes: ["classes:read"], reason: `Grant của người khác ${index}`,
        expires_at: new Date(Date.now() + 3_600_000),
      })),
    ).execute();
    expect((await repo.listGrants(a)).some((row) => row.id === target.id)).toBe(false);
    expect((await repo.listGrantsForRecipient(a, staff)).some((row) => row.id === target.id)).toBe(true);
    expect((await repo.listGrantsForRecipient(b, staff)).some((row) => row.id === target.id)).toBe(false);
  });

  it("role thực không BYPASSRLS bị chặn đọc, ghi, thu hồi và audit xuyên tenant", async () => {
    const adminPool = new Pool({ connectionString: adminUrl });
    try {
      const roles = await adminPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", [ROLE_NAME],
      );
      expect(roles.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    } finally {
      await adminPool.end();
    }
    const issued = await runInTestTenantContext(a, () =>
      rlsRepo.createGrant({
        tenantId: a, recipientId: staff, createdBy: ownerA,
        scopes: ["classes:read"], expiresAt: new Date(Date.now() + 120_000),
        reason: "Kiểm tra RLS của role ứng dụng",
      }),
    );
    await runInTestTenantContext(a, async () => {
      await rlsRepo.appendAudit({
        tenantId: a, grantId: issued.id, actorId: ownerA,
        action: "grant_created", scope: null,
      });
      expect((await rlsRepo.listGrants(a)).some((row) => row.id === issued.id)).toBe(true);
    });
    await runInTestTenantContext(b, async () => {
      expect(await rlsRepo.findGrant(a, issued.id)).toBeUndefined();
      expect((await rlsRepo.listAudit(a)).some((row) => row.grantId === issued.id)).toBe(false);
      expect(await rlsRepo.revokeGrant(a, issued.id, ownerB)).toBeUndefined();
      await expect(rlsRepo.createGrant({
        tenantId: a, recipientId: staff, createdBy: ownerB,
        scopes: ["classes:read"], expiresAt: new Date(Date.now() + 120_000),
        reason: "Không được ghi sang A",
      })).rejects.toThrow();
      await expect(rlsRepo.appendAudit({
        tenantId: a, grantId: issued.id, actorId: ownerB,
        action: "access_allowed", scope: "classes:read",
      })).rejects.toThrow();
    });
    expect((await repo.findGrant(a, issued.id))?.revokedAt).toBeNull();
  });

  it("ràng buộc DB cấm phạm vi không được hỗ trợ và danh sách trùng", async () => {
    await expect(
      grant(a, ["students:read"], new Date(Date.now() + 90_000)),
    ).rejects.toThrow();
    await expect(
      grant(a, ["classes:read", "classes:read"], new Date(Date.now() + 90_000)),
    ).rejects.toThrow();
  });
});
