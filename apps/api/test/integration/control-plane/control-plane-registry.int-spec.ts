import type { INestApplication } from '@nestjs/common';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ControlPlaneRepository } from '@giaokhoa/db/repositories/control-plane';
import {
  ControlPlaneRegistryService,
  SHARED_DATABASE_SCHEMA_VERSION,
  type ExistingSpaceSeed,
} from '../../../src/modules/control-plane/control-plane.service';
import { UsersService } from '../../../src/modules/users/users.service';
import { createTestApp } from '../../support/identity-access-helpers';

const CP_DATABASE = 'giaokhoa_test_cp_580';
const CP_ROLE = 'giaokhoa_cp_test_580';
const CP_PASSWORD = 'cp-test-580';
const BIZ_ROLE = 'giaokhoa_biz_test_580';

const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

function clusterUrl(database: string, username?: string, secret?: string): string {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = `/${database}`;
  if (username) base.username = username;
  if (secret) base.password = secret;
  return base.toString();
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function applyControlPlaneMigrations(connectionString: string): Promise<void> {
  const outDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'control-plane');
  const folders = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  await withClient(connectionString, async (client) => {
    const version = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    if (Number(version.rows[0]!.server_version_num) < 180000) {
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await client.query(UUIDV7_SHIM);
    }
    for (const folder of folders) {
      const sql = readFileSync(join(outDir, folder, 'migration.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim();
        if (trimmed) await client.query(trimmed);
      }
    }
  });
}

describe('Control plane: sổ đăng ký không gian và registry phiên bản schema (integration)', () => {
  let app: INestApplication;
  let registry: ControlPlaneRegistryService;
  let adminId: string;
  let guestId: string;
  let createdSpaceId: string;
  let businessDatabase: string;
  let businessRole: string;

  beforeAll(async () => {
    const businessUrl = new URL(process.env.DATABASE_URL!);
    businessDatabase = decodeURIComponent(businessUrl.pathname.replace(/^\//, ''));
    businessRole = decodeURIComponent(businessUrl.username);
    await withClient(clusterUrl('postgres'), async (admin) => {
      const staleBizRole = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = '${BIZ_ROLE}'`);
      if ((staleBizRole.rowCount ?? 0) > 0) {
        await admin.query(`REVOKE CONNECT ON DATABASE ${quoted(businessDatabase)} FROM ${BIZ_ROLE}`);
      }
      await admin.query(`DROP DATABASE IF EXISTS ${CP_DATABASE} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${CP_ROLE}`);
      await admin.query(`DROP ROLE IF EXISTS ${BIZ_ROLE}`);
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${BIZ_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoted(businessDatabase)} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${quoted(businessDatabase)} TO ${quoted(businessRole)}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${quoted(businessDatabase)} TO ${BIZ_ROLE}`);
    });
    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD));
    process.env.CONTROL_PLANE_DATABASE_URL = clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD);

    app = await createTestApp();
    registry = app.get(ControlPlaneRegistryService);
    const users = app.get(UsersService);
    const admin = await users.getByUsername('admin');
    if (!admin) throw new Error('Seed chưa tạo tài khoản admin');
    adminId = admin.id;
    guestId = (await users.ensureGuestUser()).id;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.CONTROL_PLANE_DATABASE_URL;
    await withClient(clusterUrl('postgres'), async (admin) => {
      await admin.query(`GRANT CONNECT ON DATABASE ${quoted(businessDatabase)} TO PUBLIC`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoted(businessDatabase)} FROM ${BIZ_ROLE}`);
      await admin.query(`DROP DATABASE IF EXISTS ${CP_DATABASE} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${CP_ROLE}`);
      await admin.query(`DROP ROLE IF EXISTS ${BIZ_ROLE}`);
    });
  });

  it('bootstrap gieo đúng hai không gian hiện hữu vào sổ ở chế độ kho chung', async () => {
    const platform = await registry.getBySlug(adminId, 'trang-chinh');
    expect(platform.kind).toBe('platform');
    expect(platform.status).toBe('active');
    expect(platform.storageMode).toBe('shared');
    expect(platform.schemaVersion).toBe(SHARED_DATABASE_SCHEMA_VERSION);
    expect(platform.secretRef).toBe('env:DATABASE_URL');

    const school = await registry.getBySlug(adminId, 'truong-mac-dinh');
    expect(school.kind).toBe('center');
    expect(school.storageMode).toBe('shared');
    const businessDatabase = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, '');
    expect(platform.databaseName).toBe(businessDatabase);
    expect(school.databaseName).toBe(businessDatabase);
  });

  it('chạy lại đường gieo không tạo dòng trùng cho hai không gian hiện hữu', async () => {
    const businessUrl = new URL(process.env.DATABASE_URL!);
    const seeds: ExistingSpaceSeed[] = [
      {
        slug: 'trang-chinh',
        name: 'Trang chính',
        kind: 'platform',
        plan: null,
        databaseName: businessUrl.pathname.replace(/^\//, ''),
        connectionRoleRef: decodeURIComponent(businessUrl.username),
        secretRef: 'env:DATABASE_URL',
      },
      {
        slug: 'truong-mac-dinh',
        name: 'Trường mặc định',
        kind: 'center',
        plan: null,
        databaseName: businessUrl.pathname.replace(/^\//, ''),
        connectionRoleRef: decodeURIComponent(businessUrl.username),
        secretRef: 'env:DATABASE_URL',
      },
    ];
    await expect(registry.seedExistingSpaces(seeds)).resolves.toBe(0);
    const count = await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*) FROM space_registry WHERE slug IN ('trang-chinh', 'truong-mac-dinh')`,
      );
      return Number(result.rows[0]!.count);
    });
    expect(count).toBe(2);
  });

  it('tạo dòng đăng ký mới ghi kèm một dòng lịch sử create với người thực hiện và ảnh chụp sau', async () => {
    const created = await registry.createRegistration(adminId, {
      slug: 'trung-tam-test-580',
      name: 'Trung tâm test 580',
      kind: 'center',
      databaseName: 'giaokhoa_centre_test_580',
      storageMode: 'dedicated',
      connectionRoleRef: 'giaokhoa_centre_test_580_app',
      secretRef: 'env:TEST_580_DATABASE_URL',
      plan: 'standard',
    });
    createdSpaceId = created.id;
    expect(created.status).toBe('provisioning');

    const history = await registry.listHistory(adminId, created.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe('create');
    expect(history[0]!.actorId).toBe(adminId);
    expect(history[0]!.before).toBeNull();
    expect(history[0]!.after.slug).toBe('trung-tam-test-580');
    expect(history[0]!.after.plan).toBe('standard');
  });

  it('tạo dòng đăng ký trùng slug bị từ chối bằng lỗi xung đột', async () => {
    await expect(
      registry.createRegistration(adminId, {
        slug: 'trung-tam-test-580',
        name: 'Trung tâm trùng slug',
        kind: 'center',
        databaseName: 'giaokhoa_centre_dup',
        storageMode: 'dedicated',
        connectionRoleRef: 'giaokhoa_centre_dup_app',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cập nhật dòng đăng ký ghi lịch sử update với giá trị trước và sau', async () => {
    const updated = await registry.updateRegistration(adminId, createdSpaceId, {
      name: 'Trung tâm test 580 (đổi tên)',
      plan: 'premium',
    });
    expect(updated.name).toBe('Trung tâm test 580 (đổi tên)');
    expect(updated.plan).toBe('premium');

    const history = await registry.listHistory(adminId, createdSpaceId);
    const latest = history[0]!;
    expect(latest.action).toBe('update');
    expect(latest.before?.plan).toBe('standard');
    expect(latest.after.plan).toBe('premium');
    expect(latest.before?.name).toBe('Trung tâm test 580');
  });

  it('cập nhật tên database sang tên đã có ở dòng khác bị từ chối 409, kể cả khi dòng kia ở kho chung', async () => {
    const businessDatabase = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, '');
    const sharedClash = await registry
      .updateRegistration(adminId, createdSpaceId, { databaseName: businessDatabase })
      .catch((error: unknown) => error);
    expect(sharedClash).toBeInstanceOf(ConflictException);
    expect((sharedClash as ConflictException).getResponse()).toMatchObject({ code: 'control_plane.database_name_taken' });
    const other = await registry.createRegistration(adminId, {
      slug: 'trung-tam-test-611-khac',
      name: 'Trung tâm test 611 khác',
      kind: 'center',
      databaseName: 'giaokhoa_centre_test_611_other',
      storageMode: 'dedicated',
      connectionRoleRef: 'giaokhoa_centre_test_611_other_app',
    });
    await expect(
      registry.updateRegistration(adminId, createdSpaceId, { databaseName: 'giaokhoa_centre_test_611_other' }),
    ).rejects.toBeInstanceOf(ConflictException);
    const unchanged = await registry.updateRegistration(adminId, createdSpaceId, {
      databaseName: 'giaokhoa_centre_test_580',
    });
    expect(unchanged.databaseName).toBe('giaokhoa_centre_test_580');
    expect(other.databaseName).toBe('giaokhoa_centre_test_611_other');
  });

  it('chỉ đổi storageMode sang dedicated mà giữ nguyên tên database đã có ở dòng kho chung khác cũng bị từ chối 409', async () => {
    const school = await registry.getBySlug(adminId, 'truong-mac-dinh');
    expect(school.storageMode).toBe('shared');
    const rejected = await registry
      .updateRegistration(adminId, school.id, { storageMode: 'dedicated' })
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(ConflictException);
    expect((rejected as ConflictException).getResponse()).toMatchObject({ code: 'control_plane.database_name_taken' });
    const after = await registry.getBySlug(adminId, 'truong-mac-dinh');
    expect(after.storageMode).toBe('shared');
    expect(after.databaseName).toBe(school.databaseName);
  });

  it('chỉ đổi storageMode của dòng gieo đầu tiên sang dedicated cũng bị từ chối 409 (ca tự khớp)', async () => {
    const platform = await registry.getBySlug(adminId, 'trang-chinh');
    expect(platform.storageMode).toBe('shared');
    const rejected = await registry
      .updateRegistration(adminId, platform.id, { storageMode: 'dedicated' })
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(ConflictException);
    expect((rejected as ConflictException).getResponse()).toMatchObject({ code: 'control_plane.database_name_taken' });
    const unchanged = await registry.getBySlug(adminId, 'trang-chinh');
    expect(unchanged.storageMode).toBe('shared');
    expect(unchanged.databaseName).toBe(platform.databaseName);
  });

  it('tra cứu loại trừ theo tên database trả về dòng khác, không trả chính dòng bị loại', async () => {
    const platform = await registry.getBySlug(adminId, 'trang-chinh');
    const school = await registry.getBySlug(adminId, 'truong-mac-dinh');
    const repository = app.get(ControlPlaneRepository);
    const otherFromPlatform = await repository.findOtherSpaceByDatabaseName(platform.databaseName, platform.id);
    expect(otherFromPlatform?.id).toBe(school.id);
    const otherFromSchool = await repository.findOtherSpaceByDatabaseName(school.databaseName, school.id);
    expect(otherFromSchool?.id).toBe(platform.id);
    const onlyRow = await repository.findOtherSpaceByDatabaseName('giaokhoa_centre_test_580', createdSpaceId);
    expect(onlyRow).toBeUndefined();
  });

  it('đổi trạng thái vòng đời ghi lịch sử status_change; đổi về chính trạng thái hiện tại không ghi thêm', async () => {
    const changed = await registry.changeStatus(adminId, createdSpaceId, { status: 'active' });
    expect(changed.status).toBe('active');

    let history = await registry.listHistory(adminId, createdSpaceId);
    expect(history[0]!.action).toBe('status_change');
    expect(history[0]!.before?.status).toBe('provisioning');
    expect(history[0]!.after.status).toBe('active');
    const countAfterChange = history.length;

    await registry.changeStatus(adminId, createdSpaceId, { status: 'active' });
    history = await registry.listHistory(adminId, createdSpaceId);
    expect(history).toHaveLength(countAfterChange);

    await expect(registry.changeStatus(adminId, createdSpaceId, { status: 'closed' })).rejects.toMatchObject({
      response: { code: 'control_plane.close_requires_fleet_cli' },
    });
    expect((await registry.getBySlug(adminId, 'trung-tam-test-580')).status).toBe('active');
    expect(await registry.listHistory(adminId, createdSpaceId)).toHaveLength(countAfterChange);
  });

  it('tra cứu định tuyến theo slug trả đúng dòng đăng ký; slug lạ nhận lỗi không tìm thấy', async () => {
    const found = await registry.getBySlug(adminId, 'trung-tam-test-580');
    expect(found.id).toBe(createdSpaceId);
    expect(found.databaseName).toBe('giaokhoa_centre_test_580');
    await expect(registry.getBySlug(adminId, 'slug-khong-ton-tai')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('người không giữ capability quản trị platform bị từ chối ở mọi đường ghi', async () => {
    await expect(
      registry.createRegistration(guestId, {
        slug: 'trung-tam-cua-khach',
        name: 'Trung tâm của khách',
        kind: 'center',
        databaseName: 'giaokhoa_centre_guest',
        storageMode: 'dedicated',
        connectionRoleRef: 'guest_app',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(registry.changeStatus(guestId, createdSpaceId, { status: 'suspended' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(registry.getBySlug(guestId, 'trang-chinh')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registry phiên bản schema: lượt migration thành công nâng phiên bản hiện tại, lượt hỏng thì không', async () => {
    const empty = await registry.getSchemaRegistry(adminId, createdSpaceId);
    expect(empty.currentVersion).toBeNull();

    await registry.recordMigrationRun(adminId, createdSpaceId, {
      runId: 'run-580-1',
      fromVersion: null,
      toVersion: 'v2',
      status: 'success',
      steps: [{ name: 'apply-baseline', status: 'success' }],
    });
    let state = await registry.getSchemaRegistry(adminId, createdSpaceId);
    expect(state.currentVersion).toBe('v2');
    expect((await registry.getBySlug(adminId, 'trung-tam-test-580')).schemaVersion).toBe('v2');

    await registry.recordMigrationRun(adminId, createdSpaceId, {
      runId: 'run-580-2',
      fromVersion: 'v2',
      toVersion: 'v3',
      status: 'failed',
      steps: [{ name: 'apply-v3', status: 'failed', detail: 'syntax error' }],
    });
    state = await registry.getSchemaRegistry(adminId, createdSpaceId);
    expect(state.currentVersion).toBe('v2');

    const runs = await registry.listMigrationRuns(adminId, createdSpaceId);
    expect(runs.map((run) => run.runId)).toEqual(['run-580-1', 'run-580-2']);
    expect(runs[1]!.steps).toEqual([{ name: 'apply-v3', status: 'failed', detail: 'syntax error' }]);
  });

  it('registry phiên bản schema: ghi và đọc lại được trạng thái sao lưu gần nhất', async () => {
    const updated = await registry.updateSchemaRegistry(adminId, createdSpaceId, {
      lastBackupStatus: 'success',
      lastBackupAt: '2026-10-30T10:00:00+07:00',
    });
    expect(updated.lastBackupStatus).toBe('success');
    expect(updated.lastBackupAt).toBe('2026-10-30T03:00:00.000Z');
    expect(updated.currentVersion).toBe('v2');
  });

  it('registry phiên bản schema: xoá phiên bản bằng null thì dòng đăng ký cũng đồng bộ về null', async () => {
    const cleared = await registry.updateSchemaRegistry(adminId, createdSpaceId, { currentVersion: null });
    expect(cleared.currentVersion).toBeNull();
    const reread = await registry.getSchemaRegistry(adminId, createdSpaceId);
    expect(reread.currentVersion).toBeNull();
    expect((await registry.getBySlug(adminId, 'trung-tam-test-580')).schemaVersion).toBeNull();
  });

  it('hai lượt cập nhật registry chồng lấn vào hai trường độc lập không làm mất giá trị của nhau', async () => {
    const gate = new Client({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    await gate.connect();
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT space_id FROM space_schema_registry WHERE space_id = $1 FOR UPDATE', [createdSpaceId]);
      const backupWrite = registry.updateSchemaRegistry(adminId, createdSpaceId, {
        lastBackupStatus: 'success',
        lastBackupAt: '2026-10-30T11:00:00+07:00',
      });
      const restoreWrite = registry.updateSchemaRegistry(adminId, createdSpaceId, {
        lastRestoreStatus: 'success',
        lastRestoreAt: '2026-10-30T11:05:00+07:00',
      });
      await new Promise((resolve) => setTimeout(resolve, 750));
      await gate.query('COMMIT');
      await Promise.all([backupWrite, restoreWrite]);
    } finally {
      await gate.end().catch(() => undefined);
    }
    const state = await registry.getSchemaRegistry(adminId, createdSpaceId);
    expect(state.lastBackupStatus).toBe('success');
    expect(state.lastBackupAt).toBe('2026-10-30T04:00:00.000Z');
    expect(state.lastRestoreStatus).toBe('success');
    expect(state.lastRestoreAt).toBe('2026-10-30T04:05:00.000Z');
  });

  it('lượt ghi migration chồng lấn với lượt ghi trạng thái sao lưu không làm mất giá trị của nhau', async () => {
    const gate = new Client({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    await gate.connect();
    const gatePid = (await gate.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const lockWaiters = async (): Promise<{ pid: number; blockers: number[] }[]> => {
      const result = await gate.query<{ pid: number; blockers: number[] }>(
        `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      return result.rows;
    };
    const waitForBlocked = async (
      ready: (rows: { pid: number; blockers: number[] }[]) => boolean,
    ): Promise<{ pid: number; blockers: number[] }[]> => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await lockWaiters();
        if (ready(rows)) return rows;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return [];
    };
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT id FROM space_registry WHERE id = $1 FOR KEY SHARE', [createdSpaceId]);
      const backupWrite = registry.updateSchemaRegistry(adminId, createdSpaceId, {
        lastBackupStatus: 'failed',
        lastBackupAt: '2026-10-30T12:00:00+07:00',
      });
      const phase1 = await waitForBlocked((rows) => rows.some((row) => row.blockers.includes(gatePid)));
      expect(phase1.some((row) => row.blockers.includes(gatePid))).toBe(true);
      const backupPid = phase1.find((row) => row.blockers.includes(gatePid))!.pid;
      const runWrite = registry.recordMigrationRun(adminId, createdSpaceId, {
        runId: 'run-586-lock',
        fromVersion: null,
        toVersion: 'v-lock',
        status: 'success',
        steps: [{ name: 'apply-v-lock', status: 'success' }],
      });
      const phase2 = await waitForBlocked((rows) =>
        rows.some((row) => row.pid !== backupPid && (row.blockers.includes(gatePid) || row.blockers.includes(backupPid))),
      );
      expect(
        phase2.some((row) => row.pid !== backupPid && (row.blockers.includes(gatePid) || row.blockers.includes(backupPid))),
      ).toBe(true);
      await gate.query('COMMIT');
      await Promise.all([runWrite, backupWrite]);
    } finally {
      await gate.end().catch(() => undefined);
    }
    const state = await registry.getSchemaRegistry(adminId, createdSpaceId);
    expect(state.currentVersion).toBe('v-lock');
    expect(state.lastBackupStatus).toBe('failed');
    expect(state.lastBackupAt).toBe('2026-10-30T05:00:00.000Z');
    expect(state.lastRestoreStatus).toBe('success');
    expect((await registry.getBySlug(adminId, 'trung-tam-test-580')).schemaVersion).toBe('v-lock');
    const runs = await registry.listMigrationRuns(adminId, createdSpaceId);
    expect(runs.map((run) => run.runId)).toContain('run-586-lock');
  });

  it('role của control plane bị từ chối ngay ở bước mở kết nối vào kho nghiệp vụ', async () => {
    const client = new Client({ connectionString: clusterUrl(businessDatabase, CP_ROLE, CP_PASSWORD) });
    let connectError: unknown;
    try {
      await client.connect();
    } catch (err) {
      connectError = err;
    } finally {
      await client.end().catch(() => undefined);
    }
    expect(connectError).toBeInstanceOf(Error);
    expect((connectError as Error).message).toMatch(/permission denied for database/);
  });

  it('role nghiệp vụ thường vẫn mở được kết nối vào kho nghiệp vụ sau khi khoá PUBLIC', async () => {
    const database = await withClient(clusterUrl(businessDatabase, BIZ_ROLE, CP_PASSWORD), async (client) => {
      const result = await client.query<{ current_database: string }>('SELECT current_database()');
      return result.rows[0]!.current_database;
    });
    expect(database).toBe(businessDatabase);
  });

  it('role nghiệp vụ không phải superuser bị từ chối ngay ở bước mở kết nối vào database control plane', async () => {
    const client = new Client({ connectionString: clusterUrl(CP_DATABASE, BIZ_ROLE, CP_PASSWORD) });
    let connectError: unknown;
    try {
      await client.connect();
    } catch (err) {
      connectError = err;
    } finally {
      await client.end().catch(() => undefined);
    }
    expect(connectError).toBeInstanceOf(Error);
    expect((connectError as Error).message).toMatch(/permission denied for database/);
  });

  it('nhiều thao tác ghi đồng thời trên cùng dòng đăng ký cho chuỗi lịch sử liên tục, không đứt', async () => {
    const space = await registry.createRegistration(adminId, {
      slug: 'trung-tam-song-song-589',
      name: 'Trung tâm kiểm đồng thời',
      kind: 'center',
      databaseName: 'giaokhoa_centre_parallel_589',
      storageMode: 'dedicated',
      connectionRoleRef: 'giaokhoa_centre_parallel_589_app',
    });
    await Promise.allSettled([
      registry.changeStatus(adminId, space.id, { status: 'active' }),
      registry.updateRegistration(adminId, space.id, { name: 'Tên đồng thời một' }),
      registry.changeStatus(adminId, space.id, { status: 'suspended' }),
      registry.updateRegistration(adminId, space.id, { name: 'Tên đồng thời hai' }),
    ]);
    const history = await registry.listHistory(adminId, space.id);
    expect(history.length).toBeGreaterThanOrEqual(3);
    const chronological = [...history].reverse();
    for (let i = 1; i < chronological.length; i += 1) {
      expect(chronological[i]!.before).toEqual(chronological[i - 1]!.after);
    }
    const finalRow = await registry.getBySlug(adminId, 'trung-tam-song-song-589');
    expect(['Tên đồng thời một', 'Tên đồng thời hai']).toContain(finalRow.name);
    expect(['active', 'suspended']).toContain(finalRow.status);
  });

  it('nhiều lượt tạo đồng thời cùng slug: đúng một lượt thành công, các lượt còn lại nhận lỗi xung đột', async () => {
    const dto = {
      slug: 'trung-tam-trung-dong-thoi-589',
      name: 'Trung tâm trùng đồng thời',
      kind: 'center' as const,
      databaseName: 'giaokhoa_centre_race_589',
      storageMode: 'dedicated' as const,
      connectionRoleRef: 'giaokhoa_centre_race_589_app',
    };
    const results = await Promise.allSettled([
      registry.createRegistration(adminId, dto),
      registry.createRegistration(adminId, dto),
      registry.createRegistration(adminId, dto),
      registry.createRegistration(adminId, dto),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    }
    const count = await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*) FROM space_registry WHERE slug = 'trung-tam-trung-dong-thoi-589'`,
      );
      return Number(result.rows[0]!.count);
    });
    expect(count).toBe(1);
  });
});
