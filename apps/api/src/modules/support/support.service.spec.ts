/**
 * Kiểm thử cổng cấp và sử dụng grant theo từng request (issue #19).
 * Stub DB có trạng thái biến đổi để chứng minh quyết định không
 * nằm trong token/phiên hay cache, và audit cả lần từ chối.
 */
import { describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";
import type {
  SupportGrantRow,
  SupportAuditRow,
  SupportGrantsRepository,
} from "@giaokhoa/db/repositories/support-grants";

type NewGrant = Parameters<SupportGrantsRepository["createGrant"]>[0];
type NewAudit = Parameters<SupportGrantsRepository["appendAudit"]>[0];

const A = "00000000-0000-7000-8000-0000000000a1";
const B = "00000000-0000-7000-8000-0000000000b1";
const OWNER = "00000000-0000-7000-8000-0000000000c1";
const STAFF = "00000000-0000-7000-8000-0000000000d1";
const OTHER = "00000000-0000-7000-8000-0000000000e1";

/** Mô phỏng giao dịch trên handle đã định tuyến, không đưa SQL vào unit. */
function harness() {
  let currentTenant = A;
  let next = 0;
  const grants: SupportGrantRow[] = [];
  const audit: SupportAuditRow[] = [];
  const clock = () => new Date();
  const repo = {
    createGrant: vi.fn(async (data: NewGrant) => {
      const grant: SupportGrantRow = {
        id: `00000000-0000-7000-8000-${String(++next).padStart(12, "0")}`,
        ...data,
        revokedAt: null,
        revokedBy: null,
        createdAt: clock(),
      };
      grants.push(grant);
      return grant;
    }),
    listGrants: vi.fn(async (id: string) =>
      grants.filter((g) => g.tenantId === id),
    ),
    listGrantsForRecipient: vi.fn(async (id: string, recipientId: string) =>
      grants.filter((g) => g.tenantId === id && g.recipientId === recipientId),
    ),
    listAudit: vi.fn(async (id: string) =>
      audit.filter((e) => e.tenantId === id),
    ),
    appendAudit: vi.fn(async (event: NewAudit) => {
      audit.push({
        id: `00000000-0000-7000-8000-${String(++next).padStart(12, "0")}`,
        ...event,
        createdAt: clock(),
      });
    }),
    findActiveGrant: vi.fn(
      async (id: string, recipient: string, scope: string) =>
        grants.find(
          (g) =>
            g.tenantId === id &&
            g.recipientId === recipient &&
            g.scopes.includes(scope) &&
            !g.revokedAt &&
            g.expiresAt > clock(),
        ),
    ),
    revokeGrant: vi.fn(async (id: string, grantId: string, actorId: string) => {
      const g = grants.find(
        (g) => g.tenantId === id && g.id === grantId && !g.revokedAt,
      );
      if (g) {
        g.revokedAt = clock();
        g.revokedBy = actorId;
      }
      return g;
    }),
    listClasses: vi.fn(async (id: string) => [
      { id, name: "Một lớp của trung tâm", code: null, status: "active" },
    ]),
    listCourses: vi.fn(async (id: string) => [
      {
        id,
        fullName: "Một khoá của trung tâm",
        shortName: "mau",
        visible: true,
      },
    ]),
  };
  const resolverDb = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => ({
            id: currentTenant,
            kind: "center",
            status: "active",
          }),
        }),
      }),
    }),
  };
  const tenants = {
    getTenant: vi.fn(async (id: string) => ({
      id,
      kind: "center",
      status: "active",
    })),
    isPlatformSupportMember: vi.fn(async () => true),
    assertTenantManager: vi.fn(async (actor: string) => {
      if (actor !== OWNER) throw new Error("access.capability_denied");
    }),
  };
  const spaceDb = {
    routedKysely: {
      transaction: () => ({
        execute: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      }),
    },
    resolveTarget: vi.fn(async () => ({ status: "active" })),
    withSpaceKysely: vi.fn(
      async (_slug: string, fn: (db: typeof resolverDb) => Promise<unknown>) =>
        fn(resolverDb),
    ),
  };
  const service = new SupportService(
    repo as never,
    tenants as never,
    { currentTenantId: () => currentTenant } as never,
    spaceDb as never,
    { getByIdOrUndefined: vi.fn(async (id: string) => ({ id, deleted: false, suspended: false })) } as never,
  );
  return {
    service,
    repo,
    audit,
    grants,
    tenants,
    spaceDb,
    selectTenant: (id: string) => {
      currentTenant = id;
    },
  };
}

describe("Cấp quyền hỗ trợ theo tenant, người nhận, thao tác và thời gian", () => {
  it("chặn người không quản trị và yêu cầu thời hạn hữu hạn", async () => {
    const h = harness();
    const input = {
      recipientId: STAFF,
      scopes: ["classes:read"] as const,
      reason: "Lỗi lớp",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await expect(
      h.service.create(OTHER, { ...input, scopes: [...input.scopes] }),
    ).rejects.toThrow("access.capability_denied");
    await expect(
      h.service.create(OWNER, {
        ...input,
        scopes: [...input.scopes],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ response: { code: "support.invalid_expiry" } });
    await expect(
      h.service.create(OWNER, {
        ...input,
        scopes: [...input.scopes],
        expiresAt: new Date(Date.now() + 31 * 24 * 3600_000).toISOString(),
      }),
    ).rejects.toMatchObject({ response: { code: "support.invalid_expiry" } });
    expect(h.grants).toHaveLength(0);
  });

  it("không grant chặn mọi request và audit từng lần bị từ chối", async () => {
    const h = harness();
    await expect(
      h.service.access(STAFF, "centre-a", "classes:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    await expect(
      h.service.access(STAFF, "centre-a", "classes:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    expect(h.audit.map((event) => event.action)).toEqual([
      "access_denied",
      "access_denied",
    ]);
  });

  it("chỉ đúng nhân sự, đúng trung tâm và đúng thao tác; không cấp login-as", async () => {
    const h = harness();
    const issued = await h.service.create(OWNER, {
      recipientId: STAFF,
      scopes: ["classes:read"],
      reason: "Kiểm tra lỗi lớp",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(
      h.service.access(STAFF, "centre-a", "classes:read"),
    ).resolves.toHaveLength(1);
    await expect(
      h.service.access(STAFF, "centre-a", "courses:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    await expect(
      h.service.access(OTHER, "centre-a", "classes:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    h.selectTenant(B);
    await expect(
      h.service.access(STAFF, "centre-b", "classes:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    expect(await h.service.list(OWNER)).toEqual([]);
    // Trung tâm B chỉ thấy lần thử bị từ chối ngay tại B,
    // không thấy sự kiện cấp quyền hay truy cập ở A.
    expect((await h.service.audit(OWNER)).map((event) => event.action)).toEqual(
      ["access_denied"],
    );
    h.selectTenant(A);
    expect((await h.service.list(OWNER))[0]?.id).toBe(issued.id);
    expect(
      (await h.service.audit(OWNER)).filter(
        (row) => row.action === "access_denied",
      ),
    ).toHaveLength(2);
  });

  it("grant bị thu hồi và hết hạn chặn ngay request kế tiếp, audit quyết định", async () => {
    const h = harness();
    const issued = await h.service.create(OWNER, {
      recipientId: STAFF,
      scopes: ["classes:read"],
      reason: "Lỗi lớp",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(
      h.service.access(STAFF, "centre-a", "classes:read"),
    ).resolves.toHaveLength(1);
    await h.service.revoke(OWNER, issued.id);
    await expect(
      h.service.access(STAFF, "centre-a", "classes:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    const after = await h.service.create(OWNER, {
      recipientId: STAFF,
      scopes: ["courses:read"],
      reason: "Lỗi khoá",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const row = h.grants.find((g) => g.id === after.id);
    if (!row) throw new Error("Expected test grant");
    row.expiresAt = new Date(Date.now() - 1000);
    await expect(
      h.service.access(STAFF, "centre-a", "courses:read"),
    ).rejects.toMatchObject({ response: { code: "support.access_denied" } });
    expect(h.audit.map((event) => event.action)).toEqual([
      "grant_created",
      "access_allowed",
      "grant_revoked",
      "access_denied",
      "grant_created",
      "access_denied",
    ]);
    expect(
      h.audit.every((event) => !("payload" in event) && !("password" in event)),
    ).toBe(true);
  });
});
