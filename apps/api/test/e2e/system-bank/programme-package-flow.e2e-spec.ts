import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildTestDatabase, dropTestDatabase } from "@giaokhoa/db/test-support";
import {
  runSpaceProvision,
  type SpaceProvisionResult,
} from "../../../src/modules/tenants/space-provision-runner";
import {
  createTestApp,
  http,
  adminToken,
  STRONG_PASSWORD,
} from "../../support/identity-access-helpers";

/**
 * Issue #17 — luồng sản phẩm qua HTTP/Nest thực tế, không gọi trực tiếp
 * service cho các thao tác gửi/duyệt/cài. Cấp phát hai PostgreSQL riêng
 * và một control plane độc lập, kho nguồn chỉ được seed dữ kiện GDPT
 * tối thiểu. Các thay đổi / vết cài được đối chiếu bằng SQL trực tiếp.
 */
const suffix = Math.random().toString(36).slice(2, 8);
const cpName = `giaokhoa_test_17_cp_${suffix}`;
const bankName = `giaokhoa_test_17_bank_${suffix}`;
const slugA = `trung-tam-17-a-${suffix}`;
const slugB = `trung-tam-17-b-${suffix}`;
const hostA = `${slugA}.test.local`;
const hostB = `${slugB}.test.local`;
const userA = `admin17a${suffix}`;
const userB = `admin17b${suffix}`;
const pwd = "Issue17DbPassword!";
const actorId = "01901700-0000-7000-8000-000000000001";
const version1 = `17.${suffix}.1`;
const version2 = `17.${suffix}.2`;
const subjectSlug = `toan-17-${suffix}`;
const subjectId = randomUUID();
const curriculumId = randomUUID();
const nodeId = randomUUID();
const outcomeV1 = randomUUID();
const outcomeV2 = randomUUID();
const categoryId = randomUUID();
const questionId = randomUUID();
const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

const doc = (value: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;
function clusterUrl(name: string, user?: string, password?: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}
async function usingClient<T>(
  url: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
async function applySql(url: string, file: string) {
  await usingClient(url, async (db) => {
    const version = await db.query<{ server_version_num: string }>(
      "SHOW server_version_num",
    );
    if (Number(version.rows[0]!.server_version_num) < 180000) {
      await db.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await db.query(UUIDV7_SHIM);
    }
    for (const part of readFileSync(file, "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (part.trim()) await db.query(part.trim());
    }
  });
}
async function centreSql<T>(
  centre: SpaceProvisionResult,
  fn: (client: Client) => Promise<T>,
) {
  return usingClient(
    clusterUrl(centre.databaseName, centre.connectionRole, pwd),
    async (db) => {
      // Setup fixture chạy dưới chủ kho, có quyền nhìn dữ liệu toàn kho.
      await db.query("SELECT set_config('app.platform', 'on', false)");
      return fn(db);
    },
  );
}

describe("Gói chương trình #17 — gửi, duyệt, cài qua HTTP và kho riêng", () => {
  let app: INestApplication | undefined;
  let centreA: SpaceProvisionResult | undefined;
  let centreB: SpaceProvisionResult | undefined;
  let bankUrl = "";
  let platformToken = "";
  let tokenA = "";
  let tokenB = "";
  const previousEnv = {
    CONTROL_PLANE_DATABASE_URL: process.env.CONTROL_PLANE_DATABASE_URL,
    SYSTEM_BANK_DATABASE_URL: process.env.SYSTEM_BANK_DATABASE_URL,
  };

  beforeAll(async () => {
    await usingClient(clusterUrl("postgres"), (db) =>
      db.query(`CREATE DATABASE ${quoted(cpName)}`).then(() => undefined),
    );
    const migrations = join(
      __dirname,
      "../../../../../packages/db/migrations/control-plane",
    );
    for (const name of readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()) {
      await applySql(
        clusterUrl(cpName),
        join(migrations, name, "migration.sql"),
      );
    }
    bankUrl = await buildTestDatabase({
      adminUrl: clusterUrl("postgres"),
      database: bankName,
      store: "system-bank",
    });
    const env = {
      ...process.env,
      CONTROL_PLANE_DATABASE_URL: clusterUrl(cpName),
      SPACE_PROVISION_DB_PASSWORD: pwd,
    };
    const migrationsDir = join(
      __dirname,
      "../../../../../packages/db/migrations/centre",
    );
    centreA = await runSpaceProvision({
      slug: slugA,
      name: "Trung tâm nguồn A",
      adminEmail: `a17-${suffix}@example.com`,
      adminUsername: userA,
      actorId,
      databasePassword: pwd,
      env,
      migrationsDir,
      log: () => undefined,
    });
    centreB = await runSpaceProvision({
      slug: slugB,
      name: "Trung tâm đích B",
      adminEmail: `b17-${suffix}@example.com`,
      adminUsername: userB,
      actorId,
      databasePassword: pwd,
      env,
      migrationsDir,
      log: () => undefined,
    });
    // Người gửi phải thật sự có tenant:manage ở context trung tâm.
    // Site admin của kho riêng không tự vượt cổng tenant trong mô hình
    // phân quyền; gán vai manager đúng chuẩn như hệ thống vận hành.
    for (const centre of [centreA, centreB]) {
      await centreSql(centre, async (db) => {
        const role = await db.query<{ id: string }>(
          "SELECT id FROM role WHERE short_name = 'manager'",
        );
        const context = await db.query<{ id: string }>(
          "SELECT id FROM context WHERE context_level = 20 AND instance_id = $1",
          [centre.tenantId],
        );
        expect(role.rows).toHaveLength(1);
        expect(context.rows).toHaveLength(1);
        await db.query(
          "INSERT INTO role_assignments (role_id, user_id, context_id) VALUES ($1, $2, $3)",
          [role.rows[0]!.id, centre.adminUserId, context.rows[0]!.id],
        );
      });
    }
    // Giao đoạn cấp token cũ còn tra tài khoản / tenant ở kho chung.
    // Mirror chỉ phục vụ khởi tạo phiên, không chứa chương trình hay vết cài.
    await usingClient(process.env.DATABASE_URL!, async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      for (const [centre, username, email] of [
        [centreA!, userA, `a17-${suffix}@example.com`],
        [centreB!, userB, `b17-${suffix}@example.com`],
      ] as const) {
        await db.query(
          "INSERT INTO users (id, username, email) VALUES ($1, $2, $3)",
          [centre.adminUserId, username, email],
        );
        await db.query(
          "INSERT INTO tenants (id, slug, name, kind, status) VALUES ($1, $2, $3, $4, $5)",
          [centre.tenantId, centre.slug, centre.slug, "center", "active"],
        );
        await db.query(
          "INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES ($1, $2, $3)",
          [centre.tenantId, centre.adminUserId, "active"],
        );
      }
    });
    process.env.CONTROL_PLANE_DATABASE_URL = clusterUrl(cpName);
    process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
    process.env[centreA.secretEnvVar] = clusterUrl(
      centreA.databaseName,
      centreA.connectionRole,
      pwd,
    );
    process.env[centreB.secretEnvVar] = clusterUrl(
      centreB.databaseName,
      centreB.connectionRole,
      pwd,
    );
    app = await createTestApp();
    platformToken = await adminToken(app);
    for (const centre of [centreA, centreB]) {
      const activation = await http(app)
        .post("/api/v1/centres/activate-invite")
        .send({
          slug: centre.slug,
          token: centre.inviteToken,
          password: STRONG_PASSWORD,
        });
      expect(activation.status, JSON.stringify(activation.body)).toBe(201);
    }
    const loginA = await http(app)
      .post("/api/v1/auth/token")
      .set("Host", hostA)
      .send({ username: userA, password: STRONG_PASSWORD });
    const loginB = await http(app)
      .post("/api/v1/auth/token")
      .set("Host", hostB)
      .send({ username: userB, password: STRONG_PASSWORD });
    expect(loginA.status, JSON.stringify(loginA.body)).toBe(201);
    expect(loginB.status, JSON.stringify(loginB.body)).toBe(201);
    tokenA = loginA.body.accessToken;
    tokenB = loginB.body.accessToken;
    // Chỉ dữ kiện chương trình nền được seed bằng SQL. Các hành vi
    // sản phẩm gửi / duyệt / cài đều được gọi qua HTTP ở các ca test.
    await centreSql(centreA, async (db) => {
      const ctx = await db.query<{ id: string }>(
        "SELECT id FROM context WHERE context_level = 20 AND instance_id = $1",
        [centreA!.tenantId],
      );
      const contextId = ctx.rows[0]!.id;
      await db.query(
        "INSERT INTO subjects (id, context_id, name, slug, position) VALUES ($1, $2, $3, $4, 1)",
        [subjectId, contextId, "Toán 17", subjectSlug],
      );
      await db.query(
        "INSERT INTO curricula (id, subject_id, grade) VALUES ($1, $2, 12)",
        [curriculumId, subjectId],
      );
      await db.query(
        "INSERT INTO curriculum_nodes (id, curriculum_id, parent_id, title, kind, position) VALUES ($1, $2, null, $3, $4, 1)",
        [nodeId, curriculumId, "Hàm số", "topic"],
      );
      await db.query(
        "INSERT INTO learning_outcomes (id, node_id, position, content, source_kind, source_ref) VALUES ($1, $2, 1, $3::jsonb, $4, $5)",
        [
          outcomeV1,
          nodeId,
          JSON.stringify(doc("YCCĐ gốc v1")),
          "program",
          "CT Toán 12",
        ],
      );
    });
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    delete process.env[centreA?.secretEnvVar ?? "__none_A"];
    delete process.env[centreB?.secretEnvVar ?? "__none_B"];
    for (const key of [
      "CONTROL_PLANE_DATABASE_URL",
      "SYSTEM_BANK_DATABASE_URL",
    ] as const) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    if (centreA && centreB) {
      await usingClient(process.env.DATABASE_URL!, async (db) => {
        await db.query("SELECT set_config('app.platform', 'on', false)");
        for (const centre of [centreA!, centreB!]) {
          await db.query(
            "DELETE FROM tenant_memberships WHERE tenant_id = $1",
            [centre.tenantId],
          );
          await db.query("DELETE FROM tenants WHERE id = $1", [
            centre.tenantId,
          ]);
          await db.query("DELETE FROM users WHERE id = $1", [
            centre.adminUserId,
          ]);
        }
      });
    }
    await usingClient(clusterUrl("postgres"), async (db) => {
      for (const centre of [centreA, centreB]) {
        if (!centre) continue;
        await db.query(
          `DROP DATABASE IF EXISTS ${quoted(centre.databaseName)} WITH (FORCE)`,
        );
        await db.query(`DROP ROLE IF EXISTS ${quoted(centre.connectionRole)}`);
      }
      await db.query(`DROP DATABASE IF EXISTS ${quoted(cpName)} WITH (FORCE)`);
    });
    if (bankUrl) await dropTestDatabase(clusterUrl("postgres"), bankName);
  }, 300_000);

  it("A gửi, hệ thống duyệt, B cài v1 rồi v2; giữ YCCĐ gắn câu hỏi v1 và chỉ đổi kho B", async () => {
    const base = "/api/v1/system-bank/outcome-packages";
    const sent = await http(app!)
      .post(base)
      .set("Host", hostA)
      .set(auth(tokenA))
      .send({ version: version1, scope: subjectSlug, mappings: [] });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.package).toMatchObject({
      version: version1,
      status: "pending",
      centreSlug: slugA,
    });
    const before = await http(app!)
      .get(base)
      .set("Host", hostB)
      .set(auth(tokenB));
    expect(before.status).toBe(200);
    expect(
      (before.body as Array<{ version: string }>).some(
        (row) => row.version === version1,
      ),
    ).toBe(false);
    const pendingInstall = await http(app!)
      .post(`${base}/${version1}/install`)
      .set("Host", hostB)
      .set(auth(tokenB))
      .send({});
    expect(pendingInstall.status).toBe(404);
    // Trung tâm nguồn không được tự duyệt trên hostname của chính mình.
    const selfApproved = await http(app!)
      .post(`${base}/${version1}/approve`)
      .set("Host", hostA)
      .set(auth(tokenA))
      .send({});
    expect(selfApproved.status, JSON.stringify(selfApproved.body)).toBe(403);
    const centrePending = await http(app!)
      .get(`${base}/pending`)
      .set("Host", hostA)
      .set(auth(tokenA));
    expect(centrePending.status).toBe(403);
    const centrePreview = await http(app!)
      .get(`${base}/review/${version1}`)
      .set("Host", hostA)
      .set(auth(tokenA));
    expect(centrePreview.status).toBe(403);
    const approved = await http(app!)
      .post(`${base}/${version1}/approve`)
      .set(auth(platformToken))
      .send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const installed = await http(app!)
      .post(`${base}/${version1}/install`)
      .set("Host", hostB)
      .set(auth(tokenB))
      .send({});
    expect(installed.status, JSON.stringify(installed.body)).toBe(201);
    expect(installed.body.unchanged).toBe(false);
    expect(installed.body.install).toMatchObject({
      packageVersion: version1,
      scope: subjectSlug,
    });
    const retried = await http(app!)
      .post(`${base}/${version1}/install`)
      .set("Host", hostB)
      .set(auth(tokenB))
      .send({});
    expect(retried.status).toBe(201);
    expect(retried.body.unchanged).toBe(true);
    expect(retried.body.install.id).toBe(installed.body.install.id);

    // B đã dùng YCCĐ v1 trong câu; thử cài v2 có ID mới và mapping
    // phải giữ nguyên cả nội dung cũ lẫn FK của câu hỏi.
    await centreSql(centreB!, async (db) => {
      const ctx = await db.query<{ id: string }>(
        "SELECT id FROM context WHERE context_level=20 AND instance_id=$1",
        [centreB!.tenantId],
      );
      await db.query(
        "INSERT INTO question_categories (id, context_id, name) VALUES ($1, $2, $3)",
        [categoryId, ctx.rows[0]!.id, "Câu tham chiếu YCCĐ v1"],
      );
      await db.query(
        "INSERT INTO question (id, category, qtype) VALUES ($1, $2, $3)",
        [questionId, categoryId, "multichoice"],
      );
      await db.query(
        "INSERT INTO question_learning_outcomes (question_id, learning_outcome_id, cognitive_level) VALUES ($1, $2, $3)",
        [questionId, outcomeV1, "hieu"],
      );
    });
    await centreSql(centreA!, async (db) => {
      await db.query(
        "INSERT INTO learning_outcomes (id, node_id, position, content, source_kind, source_ref) VALUES ($1, $2, 2, $3::jsonb, $4, $5)",
        [
          outcomeV2,
          nodeId,
          JSON.stringify(doc("YCCĐ v2 mới")),
          "program",
          "CT Toán 12 v2",
        ],
      );
    });
    const sent2 = await http(app!)
      .post(base)
      .set("Host", hostA)
      .set(auth(tokenA))
      .send({
        version: version2,
        scope: subjectSlug,
        mappings: [
          {
            fromOutcomeId: outcomeV1,
            toOutcomeId: outcomeV2,
            note: "Văn bản đã thay đổi",
          },
        ],
      });
    expect(sent2.status, JSON.stringify(sent2.body)).toBe(201);
    const approved2 = await http(app!)
      .post(`${base}/${version2}/approve`)
      .set(auth(platformToken))
      .send({});
    expect(approved2.status, JSON.stringify(approved2.body)).toBe(201);
    const install2 = await http(app!)
      .post(`${base}/${version2}/install`)
      .set("Host", hostB)
      .set(auth(tokenB))
      .send({});
    expect(install2.status, JSON.stringify(install2.body)).toBe(201);
    expect(install2.body.install.previousVersion).toBe(version1);
    await centreSql(centreB!, async (db) => {
      const old = await db.query<{ content: unknown }>(
        "SELECT content FROM learning_outcomes WHERE id=$1",
        [outcomeV1],
      );
      const latest = await db.query<{ content: unknown }>(
        "SELECT content FROM learning_outcomes WHERE id=$1",
        [outcomeV2],
      );
      const relation = await db.query<{ learning_outcome_id: string }>(
        "SELECT learning_outcome_id FROM question_learning_outcomes WHERE question_id=$1",
        [questionId],
      );
      expect(old.rows[0]!.content).toEqual(doc("YCCĐ gốc v1"));
      expect(latest.rows[0]!.content).toEqual(doc("YCCĐ v2 mới"));
      expect(relation.rows[0]!.learning_outcome_id).toBe(outcomeV1);
      const traces = await db.query<{ package_version: string }>(
        "SELECT package_version FROM outcome_package_installs WHERE package_version = ANY($1)",
        [[version1, version2]],
      );
      expect(traces.rows.map((r) => r.package_version)).toEqual(
        expect.arrayContaining([version1, version2]),
      );
    });
    const installedA = await http(app!)
      .get(`${base}/installed`)
      .set("Host", hostA)
      .set(auth(tokenA));
    expect(installedA.status).toBe(200);
    expect(
      (installedA.body as Array<{ packageVersion: string }>).some(
        (row) =>
          row.packageVersion === version1 || row.packageVersion === version2,
      ),
    ).toBe(false);
  }, 180_000);

  it("HTTP trên kho chung không được gửi hoặc cài gói chương trình", async () => {
    const base = "/api/v1/system-bank/outcome-packages";
    const submitted = await http(app!)
      .post(base)
      .set(auth(platformToken))
      .send({
        version: `17.${suffix}.shared`,
        scope: subjectSlug,
        mappings: [],
      });
    expect(submitted.status).toBe(403);
    expect((submitted.body as { code?: string }).code).toBe(
      "system_bank.dedicated_centre_required",
    );
    const installed = await http(app!)
      .post(`${base}/${version1}/install`)
      .set(auth(platformToken))
      .send({});
    expect(installed.status).toBe(403);
  });
});
