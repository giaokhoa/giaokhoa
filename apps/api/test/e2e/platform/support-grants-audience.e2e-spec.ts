/**
 * Kiểm chứng toàn chuỗi guard HTTP cho quyền hỗ trợ issue #19:
 * token platform không qua API nghiệp vụ / login-as, token nghiệp
 * vụ không qua support-centres dù là site admin, không token bị 401.
 */
import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminToken,
  createTestApp,
  http,
} from "../../support/identity-access-helpers";

describe("Hỗ trợ trung tâm: tách audience ở chuỗi guard thật", () => {
  let app: INestApplication;
  let businessToken: string;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    businessToken = await adminToken(app);
    const res = await http(app)
      .post("/api/v1/auth/platform/login")
      .send({ username: "admin", password: "Admin123!" });
    expect(res.status).toBe(201);
    platformToken = res.body.accessToken as string;
    expect(platformToken).toBeTruthy();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it("nhân sự platform không thể quản lý grant bằng quyền nền", async () => {
    const res = await http(app)
      .get("/api/v1/support-grants")
      .set("Authorization", `Bearer ${platformToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.audience_denied");
  });

  it("token platform dù hợp lệ cũng không qua login-as nghiệp vụ", async () => {
    const res = await http(app)
      .post("/api/v1/auth/login-as")
      .set("Authorization", `Bearer ${platformToken}`)
      .send({ userId: "00000000-0000-7000-8000-000000000001" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.audience_denied");
  });

  it("token nghiệp vụ dù site admin cũng không được đọc support-centres", async () => {
    const res = await http(app)
      .get("/api/v1/support-centres/trung-tam-a/classes")
      .set("Authorization", `Bearer ${businessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.audience_denied");
  });

  it("platform admin token không dùng được bề mặt support nếu chưa có support token riêng", async () => {
    const res = await http(app)
      .get("/api/v1/support-centres/trung-tam-a/classes")
      .set("Authorization", `Bearer ${platformToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.audience_denied");
  });

  it("nhân sự hỗ trợ thông thường có token riêng nhưng không thể vào login-as hay control plane", async () => {
    const created = await (await import("../../support/identity-access-helpers")).createUserViaApi(app, businessToken);
    const { seedTenantMembershipFixture } = await import("../../support/identity-access-helpers");
    const { TenantsService } = await import("../../../src/modules/tenants/tenants.service");
    const platform = await app.get(TenantsService, { strict: false }).platformTenant();
    await seedTenantMembershipFixture(app, platform.id, created.id);
    const login = await http(app)
      .post("/api/v1/auth/support/login")
      .send({ username: created.username, password: "Passw0rd!" });
    expect(login.status).toBe(201);
    const support = login.body.accessToken as string;
    expect(support).toBeTruthy();
    const loginAs = await http(app)
      .post("/api/v1/auth/login-as")
      .set("Authorization", `Bearer ${support}`)
      .send({ userId: created.id, reason: "kiểm thử cổng" });
    expect(loginAs.status).toBe(403);
    expect(loginAs.body.code).toBe("auth.audience_denied");
    const control = await http(app)
      .get("/api/v1/control-plane/spaces/by-slug/any")
      .set("Authorization", `Bearer ${support}`);
    expect(control.status).toBe(403);
    expect(control.body.code).toBe("auth.audience_denied");
    const business = await http(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${support}`);
    expect(business.status).toBe(403);
  });

  it("cấm đăng nhập hỗ trợ ở host trung tâm dù thông tin đăng nhập đúng", async () => {
    const res = await http(app)
      .post("/api/v1/auth/support/login")
      .set("Host", "centre-a.test.local")
      .send({ username: "admin", password: "Admin123!" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.support_root_only");
  });

  it("request thiếu xác thực bị từ chối ngay trước khi tra grant/DB đích", async () => {
    const res = await http(app).get(
      "/api/v1/support-centres/trung-tam-a/classes",
    );
    expect(res.status).toBe(401);
  });
});
