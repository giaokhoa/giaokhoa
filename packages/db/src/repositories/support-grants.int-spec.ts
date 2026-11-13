/**
 * Đối chiếu repository hỗ trợ trên PostgreSQL thật và migration thật.
 * Mỗi grant có tenant, recipient, scope, expiry/revocation; audit
 * luôn mang tenant. Các phép đọc ràng buộc tenant rõ ở SQL, song song
 * chính sách RLS FORCE tại DB.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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

let db: CentreDb;
let repo: SupportGrantsRepository;
let a: string;
let b: string;
const staff = randomUUID();
const otherStaff = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();

/** Lưu một grant mẫu vào tenant, thao tác và hạn được từng ca chỉnh. */
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
}, 180_000);

afterAll(async () => {
  if (db) await db.destroy().catch(() => undefined);
  await dropTestDatabase(adminUrl, TEST_DB);
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
    // Migration cấm expires_at trước created_at; gieo cả hai mốc
    // trong quá khứ để đo expiry thật mà vẫn tôn trọng CHECK của DB.
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

  it("ràng buộc DB cấm phạm vi không được hỗ trợ và danh sách trùng", async () => {
    await expect(
      grant(a, ["students:read"], new Date(Date.now() + 90_000)),
    ).rejects.toThrow();
    await expect(
      grant(a, ["classes:read", "classes:read"], new Date(Date.now() + 90_000)),
    ).rejects.toThrow();
  });
});
