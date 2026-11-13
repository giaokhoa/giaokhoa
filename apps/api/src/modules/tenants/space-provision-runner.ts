/**
 * Pipeline cấp phát kho trung tâm hoặc khu công cộng (#583, #8,
 * chương trình tenant #579) — MỘT lệnh vận hành dựng một kho từ con số
 * không thành một kho riêng hoạt động được trên cụm chung.
 *
 * Thứ tự 7 bước (mỗi bước kiểm tra trạng thái đã làm trước khi làm — chạy lại sau sự cố tiếp tục từ bước dở dang, không tạo trùng):
 * 1. Đăng ký: dòng `space_registry` (trạng thái `provisioning`) +
 *    lịch sử `create`. Từ chối slug đã có (trừ khi chạy lại đúng trung tâm đó) và từ chối tên database đã có ở BẤT KỲ dòng nào
 *    (kể cả hàng shared — kho dedicated mang tên trùng kho chung
 *    sẽ khiến trung tâm trỏ thẳng vào kho chung). Chạy lại chỉ được khi dòng đang ở trạng thái `provisioning`; trung tâm đã đình chỉ/đóng bị từ chối, chỉ mở lại qua thao tác vòng đời tường minh (đổi trạng thái), không mở lại lặng lẽ bằng lệnh cấp phát.
 * 2. Database + role: role kết nối riêng + database riêng thuộc sở
 *    hữu role đó trên cụm chung, thu hồi CONNECT của PUBLIC, chỉ cấp cho role của trung tâm. Role đã có sẵn mà mang quyền vượt ranh giới tenant (SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, REPLICATION, hoặc là thành viên của một role đặc quyền) thì bị từ chối ngay, không nhận nuôi làm role kết nối — nhận nuôi role đặc quyền sẽ cho trung tâm quyền truy cập chéo database hoặc bỏ qua RLS. Mật khẩu role: ưu tiên biến môi trường `SPACE_PROVISION_DB_PASSWORD` (vận hành cấp tường minh, cũng là cách xoay mật khẩu khi đã mất); chưa cấp mà role chưa có thì sinh mật khẩu chữ-số và in đúng một lần; role đã có mà không cấp mật khẩu thì GIỮ NGUYÊN mật khẩu cũ (không xoay lén dưới chân môi trường triển khai đã lưu mật khẩu trước đó).
 * 3. Migration: toàn bộ migration nghiệp vụ hiện hành vào database
 *    mới bằng đúng bộ máy migration của `@giaokhoa/db`
 *    (`applyStoreMigrations`, như fleet runner), rồi ghi phiên bản
 *    schema vào registry của trung tâm.
 *    Database mới nên không cần sao lưu trước như fleet runner.
 * 4. Dữ kiện nền: context hệ thống + dòng tenant (kind `center` hoặc
 *    `platform` cho khu công cộng,
 *    trạng thái `active`) + context tenant + bản cài cục bộ gói
 *    chương trình (YCCĐ) — dump chương trình được restore nguyên
 *    văn bằng `restoreProgramDumpSql` (một transaction, neo lại
 *    context hệ thống của kho đích). Ghi nhận bản cài (phiên bản +
 *    checksum) để lần chạy lại biết kho này đã ở bản nào: bản cài
 *    khớp thì bỏ qua; chưa có bản cài mà dữ kiện đã có (chết giữa
 *    lúc restore và lúc ghi bản cài) thì chỉ ghi bản cài. Cùng bước
 *    này cài thêm BỘ VAI MẶC ĐỊNH hiện hành vào kho đích và danh mục
 *    khoá học gốc nếu là khu công cộng (bước ghi
 *    nhận `role-baseline`): cơ chế chuyển tiếp để trung tâm mới có
 *    vai mà gán ngay khi mở — xem `installCentreRoleBaseline`.
 * 5. Nhận diện: dòng `centre_identity` (tên hiển thị = tên trung
 *    tâm, logo/chưa có, màu/chưa đặt) — dữ kiện này sống trong kho của trung tâm, không nằm ở sổ đăng ký control plane.
 * 6. Quản trị đầu tiên: tài khoản KHÔNG mật khẩu (không tồn tại mật
 *    khẩu mặc định dùng chung) + membership active vào tenant + id vào `config.siteadmins` của kho trung tâm + lời mời kích hoạt (token chỉ lưu dạng băm, hạn 7 ngày). Lời mời đang chờ sẵn thì tái dùng (không cấp chồng); token gốc chỉ in ra khi tạo mới — mất link thì dùng lệnh cấp lại lời mời.
 * 7. Kích hoạt định tuyến: trạng thái sổ → `active` + lịch sử
 *    `status_change`. Từ đây khung định tuyến phục vụ trung tâm
 *    (đệm phân giải hết hạn theo TTL, không cần khởi động lại).
 *
 * Sau bước 7, vận hành còn MỘT việc ngoài pipeline (in rõ ở đầu ra):
 * thêm biến môi trường `SPACE_<SLUG>_DATABASE_URL` (URL kết nối của trung tâm) vào môi trường triển khai — sổ đăng ký chỉ giữ tham chiếu, tầng ứng dụng chỉ phân giải được trung tâm khi biến này đã có trong môi trường của nó.
 *
 * Ranh giới tin cậy: runner chạy ngoài NestJS như các công cụ fleet
 * (không gác capability — quyền chạy script của đội vận hành là
 * ranh giới), dùng đúng repository/writer của control plane và đúng bất biến ghi của tầng service.
 */
import { createHash } from 'node:crypto';
import { PUBLIC_LEARNING_SLUG } from './public-learning';
import { Client, Pool } from 'pg';
import type { SpaceRegistryRow } from '@giaokhoa/db/repositories/control-plane';
import { applyStoreMigrations } from '@giaokhoa/db/migrate';
import {
  buildCentreDatabaseUrl,
  CENTRE_INVITE_TTL_MS,
  CENTRE_PROGRAM_PACKAGE_KEY,
  deriveCentreDatabaseName,
  deriveCentreRoleName,
  deriveCentreSecretEnvVar,
  generateCentreDatabasePassword,
  generateCentreInviteToken,
  hashCentreInviteToken,
  normalizeSpaceSlug,
} from './centre-provision';
import {
  buildEnsureDatabaseStatements,
  buildEnsureRoleStatements,
  buildRestrictConnectStatements,
} from '../control-plane/control-plane-provision';
import {
  listMigrationFolders,
  readDatabaseAppliedMigrations,
  readDatabaseSchemaVersion,
  resolveCentreMigrationsDir,
  retargetUrl,
} from '../fleet/fleet-common';
import { FleetRegistryWriter } from '../fleet/fleet-registry-writer';
import { AccessRepository } from '@giaokhoa/db/repositories/access';
import { ContextsService } from '../access/contexts.service';
import { RolesService } from '../access/roles.service';
import { PlanLimitsService } from '../access/plan-limits.service';
import { RoleSeparationService } from '../access/role-separation.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { CONTEXT_LEVELS, DEFAULT_ROLES } from '../access/domain/capabilities';
import { createCentreKysely, sql as kyselySql, type CentreDb, type JsonValue } from '@giaokhoa/db';
import { isDedicatedDatabaseNameConflict } from '@giaokhoa/db/repositories/control-plane';
import {
  loadProgramDumpSql,
  PROGRAM_DUMP_VERSION,
  restoreProgramDumpSql,
} from '../curriculum/program-dump';

/** Đầu vào của một lượt cấp phát. */
export type SpaceProvisionOptions = {
  /** Chỉ khu công cộng được cấp phát kind platform; các slug khác luôn kind center. */
  kind?: 'center' | 'platform';
  /** Slug của trung tâm (chuẩn hoá theo nhãn DNS trước khi dùng). */
  slug: string;
  /** Tên hiển thị của trung tâm. */
  name: string;
  /** Gói dịch vụ của trung tâm (lưu vào sổ, null = chưa gắn gói). */
  plan?: string | null;
  /** Tên đăng nhập của quản trị đầu tiên (mặc định `admin`). */
  adminUsername?: string;
  /** Email của quản trị đầu tiên (bắt buộc — lời mời gửi tới địa chỉ này). */
  adminEmail: string;
  /** Tên riêng của quản trị đầu tiên. */
  adminFirstName?: string;
  /** Họ của quản trị đầu tiên. */
  adminLastName?: string;
  /** Ghi đè tên database (mặc định suy từ slug). */
  databaseName?: string;
  /** Mật khẩu role kết nối do vận hành cấp (mặc định đọc `SPACE_PROVISION_DB_PASSWORD`, rồi sinh mới). */
  databasePassword?: string;
  /** UUID của người vận hành — bắt buộc, ghi vào lịch sử sổ đăng ký (fail-closed khi thiếu). */
  actorId: string;
  /** Thư mục migration nghiệp vụ (mặc định: thư mục carrier trong package `@giaokhoa/db`). */
  migrationsDir?: string;
  /** Biến môi trường (mặc định `process.env`) — test chèn env riêng qua đây. */
  env?: NodeJS.ProcessEnv;
  /** Ghi nhật ký tiến trình (mặc định `console.log`). */
  log?: (message: string) => void;
};

/** Kết quả một lượt cấp phát. */
export type SpaceProvisionResult = {
  slug: string;
  spaceId: string;
  databaseName: string;
  connectionRole: string;
  secretEnvVar: string;
  /** Id tenant trong kho trung tâm (null khi chạy lại trên trung tâm đã active — không đổi gì). */
  tenantId: string | null;
  /** Id tài khoản quản trị đầu tiên (null khi chạy lại trên trung tâm đã active). */
  adminUserId: string | null;
  /** Token lời mời gốc — chỉ có khi tạo mới trong lượt này; null khi tái dùng lời mời đang chờ hoặc chạy lại. */
  inviteToken: string | null;
  /** Hạn của lời mời (tạo mới hoặc đang chờ) — null khi chạy lại trên trung tâm đã active. */
  inviteExpiresAt: Date | null;
  /** Lượt này có sinh mật khẩu database mới không (in một lần ở đầu ra). */
  passwordWasGenerated: boolean;
  /** Mật khẩu database mới sinh (chỉ khi `passwordWasGenerated`, để CLI in một lần — không ghi log nơi khác). */
  generatedPassword: string | null;
  /** `active` = cấp phát xong trong lượt này; `already-active` = trung tâm đã active sẵn, không đổi gì. */
  status: 'active' | 'already-active';
  /** Tiến trình từng bước: created = làm mới, reused = đã có sẵn nên bỏ qua. */
  steps: { name: string; outcome: 'created' | 'reused' }[];
};

/**
 * Hàm log mặc định của các lệnh runner: ghi ra stdout (kênh xuất chuẩn của script vận hành).
 */
function defaultLog(message: string): void {
  console.log(message);
}

/**
 * Kết quả truy vấn `pg` có ít nhất một dòng hay không — `rowCount` là `null` khi câu lệnh không trả dòng.
 */
function hasRows(result: { rowCount?: number | null }): boolean {
  return (result.rowCount ?? 0) > 0;
}

/**
 * Bật GUC `app.platform` ở mức PHIÊN trên một handle Kysely của kho trung tâm — ghi seed phải qua được RLS FORCE
 * của kho. GUC mức phiên (không phải transaction-local) vì restore dump chạy transaction riêng của nó mà vẫn phải
 * thấy cờ này.
 */
async function enablePlatformGuc(db: CentreDb): Promise<void> {
  await kyselySql`SELECT set_config('app.platform', 'on', false)`.execute(db);
}

/**
 * Thông điệp lỗi khi một kho đã có bản cài gói chương trình lệch phiên bản/checksum so với artifact hiện hành —
 * dùng chung giữa pipeline cấp phát và bước cài gói di trú (`SpaceProgramPackageService`) để hai đường từ chối
 * bằng cùng một câu chữ; chỉ khác tên kho (`Centre database` ở pipeline, `Centre store` ở bước di trú).
 */
export function programPackageVersionMismatchMessage(
  store: string,
  version: string,
): string {
  return `${store} already has program package ${CENTRE_PROGRAM_PACKAGE_KEY} at version ${version} (expected ${PROGRAM_DUMP_VERSION}) — refusing to overwrite; upgrade the package instead`;
}

/**
 * Kiểm tra một role PostgreSQL đã tồn tại có sạch để nhận nuôi làm
 * role kết nối của trung tâm hay không. Role chỉ sạch khi bản thân
 * nó không mang quyền vượt ranh giới tenant và không là thành viên
 * của bất kỳ role nào mang quyền đó — thành viên kế thừa quyền của
 * role chứa nó nên chỉ xét thuộc tính của chính role là chưa đủ.
 * Role không sạch bị từ chối dứt khoát (fail-closed) thay vì bị
 * chuẩn hoá lặng lẽ: hạ quyền của một role đang có chủ khác có thể
 * phá hệ thống đang dùng role đó.
 *
 * @param admin - Kết nối quản trị của cụm (đọc được `pg_roles` và
 *   `pg_auth_members`).
 * @param role - Tên role cần kiểm tra.
 * @throws Error khi role mang quyền vượt ranh giới hoặc là thành
 *   viên của role đặc quyền — thông điệp nêu rõ quyền/vi phạm.
 */
async function assertCentreRoleIsClean(admin: Client, role: string): Promise<void> {
  const attrs = await admin.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
  }>('SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = $1', [role]);
  const row = attrs.rows[0];
  if (!row) return;
  const offending = (['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication'] as const)
    .filter((key) => row[key])
    .map((key) => key.replace(/^rol/, '').toUpperCase());
  if (offending.length > 0) {
    throw new Error(`Role ${role} already exists with privileged attributes (${offending.join(', ')}) — refusing to adopt it as a centre connection role`);
  }
  const members = await admin.query<{ rolname: string }>(
    `SELECT r.rolname FROM pg_roles r JOIN pg_auth_members m ON m.roleid = r.oid
     WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
     AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)`,
    [role],
  );
  if (hasRows(members)) {
    const names = members.rows.map((member) => member.rolname).join(', ');
    throw new Error(`Role ${role} is a member of privileged role(s) (${names}) — refusing to adopt it as a centre connection role`);
  }
}

/**
 * Khoá của dấu mốc hoàn tất cài bộ vai trong bảng `config` của
 * chính kho trung tâm (cùng khuôn khoá `siteadmins`): sự hiện
 * diện của dòng này — với đúng phiên bản dấu mốc — là bằng
 * chứng một lượt cài đã chạy trọn tới cuối. Phiên bản tăng khi
 * ngữ nghĩa hoàn tất của cơ chế chuyển tiếp này đổi, để dấu mốc
 * của bản cũ không bị đọc thành đã cài theo ngữ nghĩa mới.
 */
const ROLE_BASELINE_MARKER_KEY = 'rolebaseline';
const ROLE_BASELINE_MARKER_VERSION = 1;

/**
 * Cài bộ vai mặc định hiện hành vào kho của một trung tâm — cơ chế
 * CHUYỂN TIẾP trong chương trình tenant: trung tâm mới cấp phát
 * phải có sẵn bộ vai để quản trị gán ngay khi trung tâm mở, trong
 * lúc mẫu quyền chính thức (đi qua migration có phiên bản) thuộc
 * một đợt riêng chưa thi công. Khi đợt đó thi công, bước chuyển
 * tiếp này được thay thế tại đó; ở đây tuyệt đối không định nghĩa
 * mô hình vai mới.
 *
 * Tái dùng đúng đường gieo của kho chung: dựng các service của
 * module access trên CHÍNH handle của kho đích rồi gọi nguyên
 * `RolesService.seedDefaults` — định nghĩa vai/năng lực
 * (`DEFAULT_ROLES`, `CAPABILITY_DEFINITIONS`) và logic gieo chỉ
 * có một nguồn duy nhất ở module access, không sao chép danh sách
 * sang pipeline này. Các service còn lại trong bộ phụ thuộc của
 * `RolesService` (outbox, hạn mức gói, tách vai) được dựng cùng
 * handle nhưng `seedDefaults` không gọi tới chúng.
 *
 * Idempotent theo khuôn các bước còn lại của pipeline (kiểm tra
 * trạng thái trước khi làm), nhưng phán quyết "đã cài" KHÔNG dựa
 * vào nội dung ma trận: `seedDefaults` không chạy trong
 * transaction và luôn tạo dòng vai trước ma trận của chính vai
 * đó, nên một lượt cài chết đúng đoạn ghi ma trận của vai cuối
 * để lại trạng thái "đủ dòng vai, thiếu một phần ma trận" — mà
 * một phần ma trận thiếu thì không phân biệt được bằng nội dung
 * với dòng ma trận do quản trị trung tâm xoá có chủ đích sau
 * khi cài (trạng thái bắt buộc phải giữ nguyên). Dấu mốc hoàn
 * tất trong bảng `config` của chính kho đích là bằng chứng duy
 * nhất tách hai trạng thái này:
 *
 * - Kho được coi là đã cài khi có dấu mốc hoàn tất (đúng phiên
 *   bản) VÀ còn đủ dòng vai mặc định. Điều kiện đủ dòng vai đi
 *   kèm để một kho bị xoá sạch đường cơ sở vai (trạng thái của
 *   trung tâm cấp phát trước khi cơ chế này tồn tại — dòng
 *   config vẫn còn khi chỉ hai bảng vai bị xoá) vẫn được lấp
 *   lại thay vì tin dấu mốc cũ. Kho đã cài là no-op tuyệt đối:
 *   không ghi gì, không đọc tới nội dung ma trận — giá trị
 *   quản trị đã sửa và dòng quản trị đã xoá đều giữ nguyên.
 * - Mọi trạng thái còn lại (kho mới, thiếu vai, hoặc đủ vai
 *   nhưng chưa có dấu mốc — tức lượt cài trước chưa chạy trọn,
 *   kể cả kho đã được cài bởi bản chưa có dấu mốc) đều đi đường
 *   gieo: `seedDefaults` lấp đủ bộ vai kèm ma trận, rồi dấu
 *   mốc mới được ghi SAU KHI đường gieo đã chạy trọn. Lượt cài
 *   chết giữa đường gieo và lúc ghi dấu mốc thì dấu mốc chưa
 *   có nên lần chạy lại gieo lại từ đầu; tại thời điểm đó
 *   trung tâm chưa kích hoạt và chưa có tài khoản quản trị nào
 *   trong kho (bước cài vai chạy trước bước tạo quản trị đầu
 *   tiên) nên việc đồng bộ lại ma trận không mất thay đổi cục
 *   bộ nào.
 *
 * @param accessDb - Handle Kysely của kho đích (pool riêng
 *   trần 1 kết nối đã mang GUC platform ở mức phiên — seed
 *   ghi qua AccessRepository phải qua RLS FORCE như mọi ghi
 *   seed khác, cùng khuôn pool riêng của bước restore gói
 *   chương trình). Cùng handle này dựng `OutboxService`
 *   (service đã chuyển sang Kysely ở D1, issue #653) và hai
 *   facade access `PlanLimitsService`/`RoleSeparationService`
 *   qua stub mang `routedKysely` trỏ về chính nó. Closure này
 *   chỉ gọi `listRoles`/`seedDefaults` — cả hai đều không
 *   phát sự kiện qua outbox và không truy vấn qua hai lõi
 *   access — nên các handle dựng service chỉ để đúng hợp
 *   đồng, không mở thêm kết nối nào trong lượt cài này.
 * @returns `created` khi lượt này đã chạy đường gieo và ghi dấu
 *   mốc hoàn tất, `reused` khi kho đã cài trọn bộ vai nên không
 *   đổi gì.
 */
async function installCentreRoleBaseline(accessDb: CentreDb): Promise<'created' | 'reused'> {
  const accessRepository = new AccessRepository(accessDb);
  const contextsService = new ContextsService(accessRepository);
  const rolesService = new RolesService(
    accessRepository,
    contextsService,
    new OutboxService(accessDb),
    new PlanLimitsService({ routedKysely: accessDb } as unknown as SpaceDatabaseService),
    new RoleSeparationService({ routedKysely: accessDb } as unknown as SpaceDatabaseService),
  );
  const existingRoles = await rolesService.listRoles();
  const presentShortNames = new Set(existingRoles.map((row) => row.shortName));
  const allRolesPresent = DEFAULT_ROLES.every((definition) => presentShortNames.has(definition.shortName));
  const marker = await accessRepository.getConfigValue(ROLE_BASELINE_MARKER_KEY);
  const installCompleted =
    typeof marker === 'object' &&
    marker !== null &&
    (marker as { version?: unknown }).version === ROLE_BASELINE_MARKER_VERSION;
  if (allRolesPresent && installCompleted) {
    return 'reused';
  }
  await rolesService.seedDefaults();
  await accessRepository.setConfigValue(ROLE_BASELINE_MARKER_KEY, { version: ROLE_BASELINE_MARKER_VERSION });
  return 'created';
}

/**
 * Trạng thái dùng chung của một lượt cấp phát — các hàm bước đọc qua đây thay vì đóng biến cục bộ của
 * `runSpaceProvision`, để mỗi bước là một hàm có tên riêng mà vẫn giữ nguyên thứ tự và hành vi.
 */
type ProvisionContext = {
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
  slug: string;
  kind: 'center' | 'platform';
  name: string;
  plan: string | null;
  adminUsername: string;
  adminEmail: string;
  adminFirstName?: string;
  adminLastName?: string;
  actorId: string;
  databaseName: string;
  connectionRole: string;
  secretEnvVar: string;
  migrationsDir: string;
  databasePassword?: string;
  steps: SpaceProvisionResult['steps'];
  writer: FleetRegistryWriter;
};

/** Ghi nhận kết quả một bước vào `steps` kèm dòng log tiến trình (thay cho closure `step` cũ trong `runSpaceProvision`). */
function recordStep(
  ctx: ProvisionContext,
  name: string,
  outcome: 'created' | 'reused',
): void {
  ctx.steps.push({ name, outcome });
  ctx.log(`[provision:${ctx.slug}] ${name}: ${outcome}`);
}

/**
 * Chèn một dòng context rồi cập nhật lại `path`/`depth` theo id vừa chèn — `path` chỉ tính được sau khi có id
 * (dạng `/<id>` hoặc nối vào `path` của context cha), nên lượt chèn nào cũng đi hai câu: insert với `path` rỗng
 * rồi update lại `path`/`depth`.
 */
async function insertContext(
  db: CentreDb,
  level: (typeof CONTEXT_LEVELS)[keyof typeof CONTEXT_LEVELS],
  instanceId: string | null,
  pathOf: (id: string) => string,
  depth: number,
): Promise<string> {
  const inserted = await db
    .insertInto('context')
    .values({
      context_level: level,
      instance_id: instanceId,
      path: '',
      depth: 0,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('context')
    .set({ path: pathOf(inserted.id), depth })
    .where('id', '=', inserted.id)
    .execute();
  return inserted.id;
}

/**
 * Bước 1: dòng đăng ký (chạy lại an toàn) — xem TSDoc đầu file của `runSpaceProvision` về luật từ chối slug/database
 * đã có và luật chỉ chạy lại khi dòng đang ở trạng thái `provisioning`.
 *
 * @returns Id dòng đăng ký và cờ `alreadyActive` (trung tâm đã active sẵn — nơi gọi trả kết quả `already-active`
 *   mà không đổi gì).
 */
async function provisionRegistration(
  ctx: ProvisionContext,
): Promise<{ spaceId: string; alreadyActive: boolean }> {
  const existing = await ctx.writer.findSpaceBySlug(ctx.slug);
  if (existing) {
    if (existing.kind !== ctx.kind) {
      throw new Error(`Space ${ctx.slug} is registered as ${existing.kind}, expected ${ctx.kind}`);
    }
    if (existing.storageMode !== 'dedicated') {
      throw new Error(`Slug ${ctx.slug} is already registered as a ${existing.storageMode} space (id ${existing.id}) — refusing to take it over`);
    }
    if (existing.databaseName !== ctx.databaseName) {
      throw new Error(`Slug ${ctx.slug} is already registered with database ${existing.databaseName}, not ${ctx.databaseName} — refusing to take it over`);
    }
    if (existing.status === 'active') {
      ctx.log(`[provision:${ctx.slug}] already active — nothing changed`);
      return { spaceId: existing.id, alreadyActive: true };
    }
    // Chạy lại chỉ được tiếp tục khi dòng đang ở trạng thái
    // `provisioning` (lượt cấp phát trước dở dang): trung tâm đã
    // đình chỉ/đóng mà chạy lại lệnh cấp phát sẽ bị bước kích
    // hoạt cuối đặt lại `active` một cách lặng lẽ — mở lại phải
    // qua thao tác đổi trạng thái tường minh, không qua đây.
    if (existing.status !== 'provisioning') {
      throw new Error(`Space ${ctx.slug} is in status ${existing.status} — refusing to re-run provisioning; resume it only through an explicit lifecycle status change`);
    }
    recordStep(ctx, 'registration', 'reused');
    return { spaceId: existing.id, alreadyActive: false };
  }
  const clash = await ctx.writer.findSpaceByDatabaseName(ctx.databaseName);
  if (clash) {
    throw new Error(`Database name ${ctx.databaseName} is already used by space ${clash.slug} — refusing to provision a second centre on it`);
  }
  let row: SpaceRegistryRow | undefined;
  try {
    row = await ctx.writer.createSpaceRegistration(ctx.actorId, {
      slug: ctx.slug, name: ctx.name, kind: ctx.kind, databaseName: ctx.databaseName, connectionRoleRef: ctx.connectionRole, secretRef: `env:${ctx.secretEnvVar}`, plan: ctx.plan,
    });
  } catch (error) {
    if (isDedicatedDatabaseNameConflict(error)) {
      throw new Error(`Database name ${ctx.databaseName} is already used by another dedicated space — refusing to provision a second centre on it`, { cause: error });
    }
    throw error;
  }
  if (!row) throw new Error(`Slug ${ctx.slug} was registered concurrently — re-run provisioning to resume`);
  recordStep(ctx, 'registration', 'created');
  return { spaceId: row.id, alreadyActive: false };
}

/**
 * Bước 2: role + database trên cụm (chạy lại an toàn) — role kết nối riêng + database riêng thuộc sở hữu role đó,
 * thu hồi CONNECT của PUBLIC, chỉ cấp cho role của trung tâm. Role đã có sẵn mà mang quyền vượt ranh giới tenant
 * thì bị từ chối ngay (xem `assertCentreRoleIsClean`); mật khẩu role: ưu tiên biến vận hành, chưa cấp mà role chưa
 * có thì sinh mới, role đã có mà không cấp thì giữ nguyên mật khẩu cũ.
 *
 * @returns Cờ/mật khẩu role vừa sinh (để CLI in một lần và các bước sau dựng URL kết nối).
 */
async function provisionDatabaseAndRole(
  ctx: ProvisionContext,
  adminUrl: string,
): Promise<{ passwordWasGenerated: boolean; generatedPassword: string | null }> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  let passwordWasGenerated = false;
  let generatedPassword: string | null = null;
  try {
    const roleRow = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ctx.connectionRole]);
    const roleExists = hasRows(roleRow);
    // Role đã có thì kiểm tra sạch TRƯỚC khi nhận nuôi (kể cả khi
    // không cấp mật khẩu mới — role vẫn được dùng làm role kết
    // nối ở các bước sau qua URL trong biến môi trường): câu lệnh
    // đảm bảo role chỉ đồng bộ mật khẩu, không hạ quyền, nên role
    // đặc quyền mà lọt qua đây sẽ giữ nguyên quyền vượt ranh giới.
    if (roleExists) await assertCentreRoleIsClean(admin, ctx.connectionRole);
    const providedPassword = ctx.databasePassword ?? ctx.env.SPACE_PROVISION_DB_PASSWORD;
    let rolePassword: string | null;
    if (providedPassword) {
      rolePassword = providedPassword;
    } else if (!roleExists) {
      rolePassword = generateCentreDatabasePassword();
      passwordWasGenerated = true;
      generatedPassword = rolePassword;
    } else {
      // Role đã có mà vận hành không cấp mật khẩu: giữ nguyên mật
      // khẩu cũ — xoay lén sẽ làm môi trường triển khai đã lưu mật
      // khẩu trước đó mất kết nối tới kho này.
      rolePassword = null;
    }
    if (rolePassword !== null) {
      for (const stmt of buildEnsureRoleStatements({ database: ctx.databaseName, role: ctx.connectionRole, rolePassword }, roleExists)) {
        await admin.query(stmt);
      }
    }
    const dbRow = await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1', [ctx.databaseName]);
    if (dbRow.rows.length > 0) {
      const owner = dbRow.rows[0].owner as string;
      if (owner !== ctx.connectionRole) {
        throw new Error(`Database ${ctx.databaseName} already exists owned by ${owner}, not ${ctx.connectionRole} — refusing to take it over`);
      }
    } else {
      for (const stmt of buildEnsureDatabaseStatements({ database: ctx.databaseName, role: ctx.connectionRole, rolePassword: rolePassword ?? '' }, false)) {
        await admin.query(stmt);
      }
    }
    for (const stmt of buildRestrictConnectStatements({ database: ctx.databaseName, role: ctx.connectionRole, rolePassword: rolePassword ?? '' })) {
      await admin.query(stmt);
    }
    recordStep(ctx, 'database-role', roleExists ? 'reused' : 'created');
  } finally {
    await admin.end().catch(() => undefined);
  }
  return { passwordWasGenerated, generatedPassword };
}

/**
 * URL kết nối của trung tâm (dùng cho các bước còn lại): mật khẩu lấy từ biến vận hành, hoặc mật khẩu vừa sinh,
 * hoặc — khi role đã có và không cấp mật khẩu — mật khẩu cũ nằm trong biến môi trường của tầng ứng dụng
 * (`secretEnvVar`) nếu tiến trình này có nó. Mật khẩu ở đây phải là dạng THÔ: `buildCentreDatabaseUrl` tự mã hoá
 * phần trăm khi dựng URL, và nhánh đọc từ URL chỉ giải mã ĐÚNG MỘT LẦN (trường `password` của URL parser trả về
 * dạng đã mã hoá). Giải mã thêm một lần nữa ở đây sẽ đổi nghĩa mật khẩu chứa ký tự `%` (`%40` thành `@`, `%` lẻ
 * thành lỗi `URIError`) khiến các bước sau không mở được kết nối dù mật khẩu gốc là đúng. Không có mật khẩu thì
 * các bước sau lỗi rõ thay vì thử mật khẩu rỗng.
 */
function resolveCentreDatabaseUrl(
  ctx: ProvisionContext,
  clusterHost: string,
  clusterPort: number,
  generatedPassword: string | null,
): string {
  let centrePassword = ctx.databasePassword ?? ctx.env.SPACE_PROVISION_DB_PASSWORD ?? generatedPassword ?? null;
  if (!centrePassword && ctx.env[ctx.secretEnvVar]) {
    try {
      centrePassword = decodeURIComponent(new URL(ctx.env[ctx.secretEnvVar]!).password);
    } catch {
      centrePassword = null;
    }
  }
  if (!centrePassword) {
    throw new Error(`Cannot connect to the centre database: role ${ctx.connectionRole} already exists but no password was provided (set SPACE_PROVISION_DB_PASSWORD or ${ctx.secretEnvVar})`);
  }
  return buildCentreDatabaseUrl({ host: clusterHost, port: clusterPort, role: ctx.connectionRole, password: centrePassword, databaseName: ctx.databaseName });
}

/**
 * Bước 3: migration nghiệp vụ vào kho mới — toàn bộ migration nghiệp vụ hiện hành bằng đúng bộ máy migration của
 * `@giaokhoa/db` (`applyStoreMigrations`, như fleet runner), rồi ghi phiên bản schema vào registry của trung tâm.
 * Database mới nên không cần sao lưu trước như fleet runner.
 */
async function provisionMigrations(
  ctx: ProvisionContext,
  spaceId: string,
  centreUrl: string,
): Promise<void> {
  // Bộ máy migration của `@giaokhoa/db` (`applyStoreMigrations`) tự
  // lo bước tiền-migration shim `uuidv7()` cho cụm dưới PG18
  // trước khi áp — cùng trình tự với CLI migrate và fleet
  // runner, không bản sao tại đây.
  const migrationPool = new Pool({ connectionString: centreUrl });
  try {
    const folders = listMigrationFolders(ctx.migrationsDir);
    if (folders.length === 0) throw new Error(`No migration folders found under ${ctx.migrationsDir}`);
    const targetVersion = folders[folders.length - 1]!;
    const probe = new Client({ connectionString: centreUrl });
    await probe.connect();
    let applied: string[];
    let currentVersion: string | null;
    try {
      applied = await readDatabaseAppliedMigrations(probe);
      currentVersion = await readDatabaseSchemaVersion(probe);
    } finally {
      await probe.end().catch(() => undefined);
    }
    if (!applied.includes(targetVersion)) {
      const migrationDb = createCentreKysely(migrationPool);
      await applyStoreMigrations(migrationDb, 'centre', ctx.migrationsDir);
      const verify = new Client({ connectionString: centreUrl });
      await verify.connect();
      try {
        const appliedAfter = await readDatabaseAppliedMigrations(verify);
        const reached = await readDatabaseSchemaVersion(verify);
        const missing = folders.filter((folder) => !appliedAfter.includes(folder));
        if (missing.length > 0 || reached !== targetVersion) {
          throw new Error(`Migration verification failed: missing ${missing.join(', ') || 'none'}, version ${reached ?? 'none'} != ${targetVersion}`);
        }
      } finally {
        await verify.end().catch(() => undefined);
      }
      await ctx.writer.recordMigrationOutcome(spaceId, {
        runId: `provision-${ctx.slug}-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14)}`,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        status: 'success',
        steps: [{ name: 'apply-migrations', status: 'success' }],
      });
      recordStep(ctx, 'migrations', 'created');
    } else {
      recordStep(ctx, 'migrations', 'reused');
    }
  } finally {
    await migrationPool.end().catch(() => undefined);
  }
}

/** Context hệ thống (level 10) — neo của toàn bộ cây chương trình và tenant. */
async function ensureSystemContext(db: CentreDb): Promise<string> {
  const existingSystem = await db
    .selectFrom('context')
    .selectAll()
    .where('context_level', '=', CONTEXT_LEVELS.SYSTEM)
    .where('instance_id', 'is', null)
    .limit(1)
    .executeTakeFirst();
  if (existingSystem) return existingSystem.id;
  return insertContext(db, CONTEXT_LEVELS.SYSTEM, null, (id) => `/${id}`, 1);
}

/** Dòng tenant của trung tâm / khu công cộng (active — cổng guard yêu cầu tenant active và membership active để đi qua). */
async function ensureCentreTenant(
  ctx: ProvisionContext,
  db: CentreDb,
): Promise<string> {
  const existingTenant = await db
    .selectFrom('tenants')
    .selectAll()
    .where('slug', '=', ctx.slug)
    .limit(1)
    .executeTakeFirst();
  if (existingTenant) {
    if (existingTenant.kind !== ctx.kind || existingTenant.status !== 'active') {
      throw new Error(`Tenant ${ctx.slug} already exists in the centre database with kind ${existingTenant.kind} / status ${existingTenant.status} — refusing to take it over`);
    }
    return existingTenant.id;
  }
  const inserted = await db
    .insertInto('tenants')
    .values({ slug: ctx.slug, name: ctx.name, kind: ctx.kind, status: 'active', plan: ctx.plan })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/** Context tenant (level 20) dưới context hệ thống. */
async function ensureTenantContext(
  db: CentreDb,
  systemContextId: string,
  tenantId: string,
): Promise<void> {
  const existingTenantContext = await db
    .selectFrom('context')
    .selectAll()
    .where('context_level', '=', CONTEXT_LEVELS.TENANT)
    .where('instance_id', '=', tenantId)
    .limit(1)
    .executeTakeFirst();
  if (existingTenantContext) return;
  await insertContext(
    db,
    CONTEXT_LEVELS.TENANT,
    tenantId,
    (id) => `/${systemContextId}/${id}`,
    2,
  );
}

/**
 * Danh mục gốc của khu công cộng + context của nó: giáo viên tự đăng ký chỉ được role coursecreator tại tenant,
 * có quyền course:create trong danh mục con nhưng không có quyền category:manage để tự lập danh mục gốc. Cài một
 * lần khi provision để luồng self-service chạy được ngay từ kho mới.
 */
async function ensurePublicCategory(
  ctx: ProvisionContext,
  db: CentreDb,
  tenantId: string,
): Promise<void> {
  const existing = await db
    .selectFrom('course_categories')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id_number', '=', 'public-root')
    .limit(1)
    .executeTakeFirst();
  let categoryId: string;
  if (existing) {
    categoryId = existing.id;
  } else {
    const category = await db
      .insertInto('course_categories')
      .values({
        tenant_id: tenantId,
        id_number: 'public-root',
        name: 'Khoá học công cộng',
        path: '',
        depth: 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    categoryId = category.id;
    await db
      .updateTable('course_categories')
      .set({ path: `/${categoryId}` })
      .where('id', '=', categoryId)
      .execute();
  }

  // Context 40 là con của context tenant 20 — không ghép vào
  // context hệ thống của kho chung hay của bất kỳ trung tâm nào.
  const parentCtx = await db
    .selectFrom('context')
    .selectAll()
    .where('context_level', '=', CONTEXT_LEVELS.TENANT)
    .where('instance_id', '=', tenantId)
    .limit(1)
    .executeTakeFirstOrThrow();
  const categoryCtx = await db
    .selectFrom('context')
    .selectAll()
    .where('context_level', '=', CONTEXT_LEVELS.COURSECAT)
    .where('instance_id', '=', categoryId)
    .limit(1)
    .executeTakeFirst();
  if (!categoryCtx) {
    await insertContext(
      db,
      CONTEXT_LEVELS.COURSECAT,
      categoryId,
      (id) => `${parentCtx.path}/${id}`,
      parentCtx.depth + 1,
    );
  }
  recordStep(ctx, 'public-category', existing && categoryCtx ? 'reused' : 'created');
}

/**
 * Bản cài gói chương trình (YCCĐ) vào kho đích: khớp phiên bản + checksum thì bỏ qua; chưa có bản cài mà dữ kiện
 * đã có thì chỉ ghi bản cài (cửa sổ hỏng giữa restore và ghi bản cài); còn lại restore dump rồi ghi bản cài.
 * Bản cài cũ lệch phiên bản/checksum thì từ chối rõ — cấp phát không tự nâng cấp kho đã có (đó là việc của
 * migration gói).
 */
async function installCentreProgramPackage(
  ctx: ProvisionContext,
  db: CentreDb,
  centreUrl: string,
  systemContextId: string,
  tenantId: string,
): Promise<void> {
  const dumpSql = loadProgramDumpSql();
  const dumpChecksum = createHash('sha256').update(dumpSql).digest('hex');
  const existingInstall = await db
    .selectFrom('program_package_installs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('package_key', '=', CENTRE_PROGRAM_PACKAGE_KEY)
    .limit(1)
    .executeTakeFirst();
  if (!existingInstall || existingInstall.version !== PROGRAM_DUMP_VERSION || existingInstall.checksum !== dumpChecksum) {
    const executed = await kyselySql<{ c: string }>`SELECT COUNT(*) AS c FROM subjects`.execute(db);
    const programRecordsPresent = Number(executed.rows[0]?.c ?? 0) > 0;
    if (!existingInstall && !programRecordsPresent) {
      // `restoreProgramDumpSql` chạy trên handle Kysely
      // (issue #646). Đường seed này đang giữ GUC platform ở
      // MỨC PHIÊN trên pool seed để restore (transaction
      // riêng của nó) qua được RLS FORCE — bản restore vì vậy
      // dùng một pool RIÊNG trần 1 kết nối trên cùng
      // connection string: đặt GUC platform ở mức phiên lên
      // kết nối duy nhất đó trước, rồi transaction của restore
      // mượn lại đúng kết nối ấy (không có lượt dùng song song
      // nào khác trên pool này trong bước seed). Pool đóng
      // ngay sau restore.
      const restorePool = new Pool({ connectionString: centreUrl, max: 1 });
      const restoreDb = createCentreKysely(restorePool);
      try {
        await enablePlatformGuc(restoreDb);
        await restoreProgramDumpSql(restoreDb, dumpSql, { anchorContextId: systemContextId });
      } finally {
        await restoreDb.destroy().catch(() => undefined);
      }
    }
    if (!existingInstall) {
      await db
        .insertInto('program_package_installs')
        .values({
          tenant_id: tenantId, package_key: CENTRE_PROGRAM_PACKAGE_KEY, version: PROGRAM_DUMP_VERSION, checksum: dumpChecksum,
        })
        .execute();
    } else {
      // Bản cài cũ lệch phiên bản/checksum: gói đã đổi bản — cấp
      // phát không tự nâng cấp kho đã có (đó là việc của migration
      // gói), dừng rõ thay vì ghi đè lặng lẽ hay restore chồng.
      throw new Error(
        programPackageVersionMismatchMessage('Centre database', existingInstall.version),
      );
    }
  }
}

/**
 * Bộ vai mặc định của kho trung tâm (cơ chế chuyển tiếp — xem `installCentreRoleBaseline`): cài sau khi context hệ
 * thống và dòng tenant đã có, vì ma trận mặc định neo vào context hệ thống của chính kho này.
 */
async function installCentreRoleBaselineStep(
  ctx: ProvisionContext,
  centreUrl: string,
): Promise<void> {
  const accessPool = new Pool({ connectionString: centreUrl, max: 1 });
  const accessDb = createCentreKysely(accessPool);
  try {
    await enablePlatformGuc(accessDb);
    recordStep(ctx, 'role-baseline', await installCentreRoleBaseline(accessDb));
  } finally {
    await accessDb.destroy().catch(() => undefined);
  }
}

/**
 * Bước 4: dữ kiện nền — context hệ thống + dòng tenant + context tenant + bản cài gói chương trình (YCCĐ) + bộ vai
 * mặc định, cộng danh mục gốc nếu là khu công cộng. Chạy trên pool seed trần 1 kết nối (xem `runSpaceProvision`).
 *
 * @returns Id tenant của trung tâm trong kho đích.
 */
async function seedCentreStore(
  ctx: ProvisionContext,
  db: CentreDb,
  centreUrl: string,
): Promise<string> {
  const systemContextId = await ensureSystemContext(db);
  const tenantId = await ensureCentreTenant(ctx, db);
  await ensureTenantContext(db, systemContextId, tenantId);
  if (ctx.kind === 'platform') {
    await ensurePublicCategory(ctx, db, tenantId);
  }
  await installCentreProgramPackage(
    ctx,
    db,
    centreUrl,
    systemContextId,
    tenantId,
  );
  // Giữ nguyên hành vi cũ: bước `seed` luôn báo `created` kể cả khi chạy lại không tạo gì — đổi giá trị báo cáo
  // có thể phá test dựa vào `steps`.
  recordStep(ctx, 'seed', 'created');
  await installCentreRoleBaselineStep(ctx, centreUrl);
  return tenantId;
}

/** Bước 5: nhận diện của trung tâm (một dòng cho mỗi tenant). */
async function ensureCentreIdentity(
  ctx: ProvisionContext,
  db: CentreDb,
  tenantId: string,
): Promise<void> {
  const existingIdentity = await db
    .selectFrom('centre_identity')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .limit(1)
    .executeTakeFirst();
  if (!existingIdentity) {
    await db
      .insertInto('centre_identity')
      .values({ tenant_id: tenantId, display_name: ctx.name, logo_path: null, brand_color: null })
      .execute();
    recordStep(ctx, 'identity', 'created');
  } else {
    recordStep(ctx, 'identity', 'reused');
  }
}

/**
 * Bước 6: quản trị đầu tiên — tài khoản chưa có mật khẩu + membership + id vào `config.siteadmins` của kho trung
 * tâm + lời mời kích hoạt (token chỉ lưu dạng băm, hạn 7 ngày). Lời mời đang chờ sẵn thì tái dùng (không cấp
 * chồng); token gốc chỉ trả ra khi tạo mới.
 *
 * @returns Id tài khoản quản trị, token lời mời gốc (null khi tái dùng) và hạn của lời mời.
 */
async function ensureCentreAdmin(
  ctx: ProvisionContext,
  db: CentreDb,
  tenantId: string,
): Promise<{ adminUserId: string; inviteToken: string | null; inviteExpiresAt: Date | null }> {
  const existingUser = await db
    .selectFrom('users')
    .selectAll()
    .where('username', '=', ctx.adminUsername)
    .limit(1)
    .executeTakeFirst();
  let adminUserId: string;
  if (existingUser) {
    if (existingUser.email !== ctx.adminEmail) {
      throw new Error(`Username ${ctx.adminUsername} already exists in the centre database with a different email — refusing to take it over`);
    }
    adminUserId = existingUser.id;
  } else {
    const inserted = await db
      .insertInto('users')
      .values({
        username: ctx.adminUsername, email: ctx.adminEmail, password_hash: null,
        first_name: ctx.adminFirstName ?? '', last_name: ctx.adminLastName ?? '',
        force_password_change: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    adminUserId = inserted.id;
  }
  await db
    .insertInto('tenant_memberships')
    .values({ tenant_id: tenantId, user_id: adminUserId, status: 'active' })
    .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doNothing())
    .execute();
  const siteAdminsRow = await db
    .selectFrom('config')
    .selectAll()
    .where('key', '=', 'siteadmins')
    .limit(1)
    .executeTakeFirst();
  const currentAdmins = Array.isArray(siteAdminsRow?.value) ? (siteAdminsRow!.value as unknown[]).map((v) => String(v)) : [];
  if (!currentAdmins.includes(adminUserId)) {
    const next = [...currentAdmins, adminUserId];
    // Cột `value` là jsonb và giá trị là MẢNG cấp cao nhất:
    // phải serialize tường minh kèm `::jsonb` như khuôn ghi
    // jsonb của `@giaokhoa/db` (driver `pg` hiểu mảng cấp cao nhất
    // là mảng PostgreSQL, không phải JSON).
    const nextValue = kyselySql<JsonValue>`${JSON.stringify(next)}::jsonb`;
    if (siteAdminsRow) {
      await db.updateTable('config').set({ value: nextValue }).where('id', '=', siteAdminsRow.id).execute();
    } else {
      await db.insertInto('config').values({ key: 'siteadmins', value: nextValue }).execute();
    }
  }
  // Lời mời: đang chờ thì tái dùng (token gốc đã mất sau lần in
  // đầu — vận hành dùng lệnh cấp lại nếu mất link); chưa có thì
  // tạo mới và trả token gốc để CLI in ra.
  const pendingInvite = await db
    .selectFrom('centre_invites')
    .selectAll()
    .where('user_id', '=', adminUserId)
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', kyselySql<Date>`now()`)
    .limit(1)
    .executeTakeFirst();
  let inviteToken: string | null = null;
  let inviteExpiresAt: Date | null = null;
  if (pendingInvite) {
    inviteExpiresAt = pendingInvite.expires_at as Date;
    recordStep(ctx, 'admin-invite', 'reused');
  } else {
    inviteToken = generateCentreInviteToken();
    inviteExpiresAt = new Date(Date.now() + CENTRE_INVITE_TTL_MS);
    await db
      .insertInto('centre_invites')
      .values({
        tenant_id: tenantId, user_id: adminUserId, email: ctx.adminEmail,
        token_hash: hashCentreInviteToken(inviteToken), expires_at: inviteExpiresAt,
      })
      .execute();
    recordStep(ctx, 'admin-invite', 'created');
  }
  return { adminUserId, inviteToken, inviteExpiresAt };
}

/** Bước 7: kích hoạt định tuyến — trạng thái sổ → `active` + lịch sử `status_change` (qua `changeSpaceStatus`). */
async function activateSpace(
  ctx: ProvisionContext,
  spaceId: string,
): Promise<void> {
  await ctx.writer.changeSpaceStatus(spaceId, 'active', ctx.actorId);
  recordStep(ctx, 'activation', 'created');
}

/**
 * Chạy pipeline cấp phát trung tâm mới.
 *
 * @param options - Đầu vào của lượt cấp phát.
 * @returns Kết quả lượt cấp phát (xem `SpaceProvisionResult`).
 * @throws Error khi đầu vào sai (slug, actorId, thiếu cấu hình) hoặc
 *   bất kỳ bước nào hỏng — lỗi mang tên bước để vận hành chạy lại
 *   đúng từ bước dở dang.
 */
export async function runSpaceProvision(options: SpaceProvisionOptions): Promise<SpaceProvisionResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? defaultLog;
  const slug = normalizeSpaceSlug(options.slug);
  const kind = options.kind ?? 'center';
  if (kind === 'platform' && slug !== PUBLIC_LEARNING_SLUG) {
    throw new Error(`Only ${PUBLIC_LEARNING_SLUG} may be provisioned as a public platform store`);
  }
  if (kind === 'center' && slug === PUBLIC_LEARNING_SLUG) {
    throw new Error(`Slug ${PUBLIC_LEARNING_SLUG} is reserved for the public learning store`);
  }
  const name = options.name.trim();
  if (!name) throw new Error('Space name is required');
  const adminUsername = (options.adminUsername ?? 'admin').trim().toLowerCase();
  if (!adminUsername) throw new Error('Admin username is required');
  const adminEmail = options.adminEmail.trim().toLowerCase();
  if (!adminEmail) throw new Error('Admin email is required');
  const actorId = options.actorId.trim();
  if (!actorId) throw new Error('actorId is required: pass the operator admin user id with --actor-id (history rows require an actor)');
  if (!env.CONTROL_PLANE_DATABASE_URL) throw new Error('CONTROL_PLANE_DATABASE_URL is required for provisioning');
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to derive the cluster admin connection');

  const databaseName = options.databaseName ?? deriveCentreDatabaseName(slug);
  const connectionRole = deriveCentreRoleName(slug);
  const secretEnvVar = deriveCentreSecretEnvVar(slug);
  // Carrier đã dời về `packages/db/migrations/centre` (issue #639):
  // mặc định mới phân giải qua vị trí package `@giaokhoa/db` (đúng cả
  // khi chạy từ repo lẫn từ image production đóng gói); option
  // tường minh vẫn thắng mặc định như trước.
  const migrationsDir = options.migrationsDir ?? resolveCentreMigrationsDir();
  const steps: SpaceProvisionResult['steps'] = [];
  const writer = new FleetRegistryWriter(env);
  const ctx: ProvisionContext = {
    env,
    log,
    slug,
    kind,
    name,
    plan: options.plan ?? null,
    adminUsername,
    adminEmail,
    adminFirstName: options.adminFirstName,
    adminLastName: options.adminLastName,
    actorId,
    databaseName,
    connectionRole,
    secretEnvVar,
    migrationsDir,
    databasePassword: options.databasePassword,
    steps,
    writer,
  };

  // Kết nối quản trị của cụm: ưu tiên DATABASE_ADMIN_URL, dự phòng
  // DATABASE_URL trỏ về database `postgres` (cùng khuôn setup).
  const adminUrl = retargetUrl(env.DATABASE_ADMIN_URL ?? databaseUrl, 'postgres');
  const adminParsed = new URL(adminUrl);
  const clusterHost = adminParsed.hostname;
  const clusterPort = adminParsed.port ? Number(adminParsed.port) : 5432;
  try {
    // ---- Bước 1: dòng đăng ký (chạy lại an toàn) ----
    const registration = await provisionRegistration(ctx);
    if (registration.alreadyActive) {
      return {
        slug,
        spaceId: registration.spaceId,
        databaseName,
        connectionRole,
        secretEnvVar,
        tenantId: null,
        adminUserId: null,
        inviteToken: null,
        inviteExpiresAt: null,
        passwordWasGenerated: false,
        generatedPassword: null,
        status: 'already-active',
        steps,
      };
    }
    const spaceId = registration.spaceId;

    // ---- Bước 2: role + database trên cụm (chạy lại an toàn) ----
    const { passwordWasGenerated, generatedPassword } =
      await provisionDatabaseAndRole(ctx, adminUrl);

    const centreUrl = resolveCentreDatabaseUrl(
      ctx,
      clusterHost,
      clusterPort,
      generatedPassword,
    );

    // ---- Bước 3: migration nghiệp vụ vào kho mới ----
    await provisionMigrations(ctx, spaceId, centreUrl);

    // ---- Bước 4–6: dữ kiện nền, nhận diện, quản trị đầu tiên ----
    // Một pool riêng trần 1 kết nối với GUC platform ở mức phiên:
    // mọi ghi seed (kể cả restore dump chạy transaction riêng của
    // nó trên pool riêng của nó) đều thấy platform='on' nên qua
    // được RLS FORCE của kho mới. Trần 1 kết nối + các câu lệnh
    // đều chạy tuần tự nên mọi câu đều mượn đúng kết nối duy nhất
    // mang GUC phiên đó (cùng khuôn pool trần 1 của bước restore
    // ở dưới).
    const seedPool = new Pool({ connectionString: centreUrl, max: 1 });
    const db = createCentreKysely(seedPool);
    try {
      // GUC platform ở mức phiên (không phải transaction-local):
      // restore dump chạy transaction riêng của nó nên GUC phải tồn
      // tại ngoài transaction mới tới được bên trong nó.
      await enablePlatformGuc(db);
      const tenantId = await seedCentreStore(ctx, db, centreUrl);
      await ensureCentreIdentity(ctx, db, tenantId);
      const { adminUserId, inviteToken, inviteExpiresAt } =
        await ensureCentreAdmin(ctx, db, tenantId);

      // ---- Bước 7: kích hoạt định tuyến ----
      await activateSpace(ctx, spaceId);
      return {
        slug,
        spaceId,
        databaseName,
        connectionRole,
        secretEnvVar,
        tenantId,
        adminUserId,
        inviteToken,
        inviteExpiresAt,
        passwordWasGenerated,
        generatedPassword,
        status: 'active',
        steps,
      };
    } finally {
      await db.destroy().catch(() => undefined);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
}

/** Đầu vào của lệnh cấp lại / huỷ lời mời kích hoạt. */
export type CentreInviteOptions = {
  slug: string;
  /** Email của tài khoản nhận lời mời (khớp đúng email của tài khoản trong kho trung tâm). */
  email: string;
  /** Chỉ huỷ các lời mời đang chờ, không tạo mới. */
  revokeOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

/** Kết quả lệnh lời mời. */
export type CentreInviteResult = {
  slug: string;
  userId: string;
  /** Số lời mời đang chờ đã bị huỷ trong lượt này. */
  revokedCount: number;
  /** Token lời mời mới (null khi chỉ huỷ). */
  inviteToken: string | null;
  /** Hạn của lời mời mới (null khi chỉ huỷ). */
  inviteExpiresAt: Date | null;
};

/**
 * Phân giải URL kết nối kho trung tâm từ sổ đăng ký control plane — prologue dùng chung của lệnh cấp lại lời mời
 * và lệnh cài bộ vai: đọc dòng đăng ký theo slug, chỉ nhận trung tâm ở kho riêng, lấy tham chiếu bí mật dạng
 * `env:<TÊN BIẾN>` rồi đọc URL kết nối từ biến môi trường đó.
 *
 * @returns Writer sổ đăng ký (nơi gọi sở hữu và phải đóng) + URL kết nối kho trung tâm.
 * @throws Error khi trung tâm chưa đăng ký, không ở kho riêng, không có tham chiếu bí mật `env:` hoặc biến môi
 *   trường URL chưa có — lỗi nào cũng fail-closed trước khi chạm kho trung tâm.
 */
async function openCentreStore(
  env: NodeJS.ProcessEnv,
  slug: string,
): Promise<{ writer: FleetRegistryWriter; centreUrl: string }> {
  const writer = new FleetRegistryWriter(env);
  try {
    const space = await writer.findSpaceBySlug(slug);
    if (!space) throw new Error(`Space ${slug} is not registered`);
    if (space.storageMode !== 'dedicated') throw new Error(`Space ${slug} is not a dedicated centre space`);
    const secretRef = space.secretRef;
    if (!secretRef?.startsWith('env:')) throw new Error(`Space ${slug} has no env secret reference to connect with`);
    const secretEnvVar = secretRef.slice('env:'.length);
    const centreUrl = env[secretEnvVar];
    if (!centreUrl) throw new Error(`Connection URL env var ${secretEnvVar} is not set in this environment`);
    return { writer, centreUrl };
  } catch (error) {
    await writer.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Cấp lại lời mời kích hoạt cho một tài khoản của trung tâm (dùng
 * khi link kích hoạt đầu tiên bị mất sau khi token gốc đã in ra —
 * token gốc không lưu nên không thể "gửi lại" mà chỉ có thể cấp
 * mới): huỷ mọi lời mời đang chờ của tài khoản rồi tạo một lời mời
 * mới (hạn 7 ngày). Với `--revoke` thì chỉ huỷ, không tạo mới.
 *
 * @param options - Slug trung tâm + email tài khoản.
 * @returns Kết quả lệnh (xem `CentreInviteResult`).
 * @throws Error khi trung tâm chưa đăng ký, chưa active, tài khoản
 *   không tồn tại trong kho trung tâm, hoặc biến môi trường URL kết
 *   nối của trung tâm chưa có trong môi trường chạy lệnh.
 */
export async function manageCentreInvite(options: CentreInviteOptions): Promise<CentreInviteResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? defaultLog;
  const slug = normalizeSpaceSlug(options.slug);
  const email = options.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required');
  if (!env.CONTROL_PLANE_DATABASE_URL) throw new Error('CONTROL_PLANE_DATABASE_URL is required');
  const { writer, centreUrl } = await openCentreStore(env, slug);
  try {
    // Pool trần 1 kết nối mang GUC platform ở mức phiên như mọi
    // đường ghi vào kho trung tâm của runner này.
    const pool = new Pool({ connectionString: centreUrl, max: 1 });
    const db = createCentreKysely(pool);
    try {
      await enablePlatformGuc(db);
      const tenant = await db.selectFrom('tenants').selectAll()
        .where('slug', '=', slug).limit(1).executeTakeFirst();
      if (!tenant) throw new Error(`Tenant ${slug} does not exist in the centre database yet`);
      const user = await db.selectFrom('users').selectAll()
        .where('email', '=', email).limit(1).executeTakeFirst();
      if (!user) throw new Error(`No user with email ${email} in the centre database`);
      const pending = await db.selectFrom('centre_invites').selectAll()
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', kyselySql<Date>`now()`)
        .execute();
      for (const invite of pending) {
        await db.updateTable('centre_invites').set({ revoked_at: new Date() }).where('id', '=', invite.id).execute();
      }
      log(`[invite:${slug}] revoked ${pending.length} pending invite(s) for ${email}`);
      if (options.revokeOnly) {
        return { slug, userId: user.id, revokedCount: pending.length, inviteToken: null, inviteExpiresAt: null };
      }
      const inviteToken = generateCentreInviteToken();
      const inviteExpiresAt = new Date(Date.now() + CENTRE_INVITE_TTL_MS);
      await db.insertInto('centre_invites').values({
        tenant_id: tenant.id, user_id: user.id, email,
        token_hash: hashCentreInviteToken(inviteToken), expires_at: inviteExpiresAt,
      }).execute();
      return { slug, userId: user.id, revokedCount: pending.length, inviteToken, inviteExpiresAt };
    } finally {
      await db.destroy().catch(() => undefined);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
}

/** Đầu vào của lệnh cài riêng bộ vai mặc định cho trung tâm đã cấp phát. */
export type SpaceRoleBaselineOptions = {
  slug: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

/** Kết quả lệnh cài bộ vai: `created` = lượt này đã cài, `reused` = kho đã cài trọn bộ vai nên không đổi gì. */
export type SpaceRoleBaselineResult = {
  slug: string;
  outcome: 'created' | 'reused';
};

/**
 * Cài bộ vai mặc định vào kho của một trung tâm ĐÃ cấp phát (lệnh
 * `install-roles` của CLI cấp phát) — đường áp cơ chế chuyển tiếp
 * cho các trung tâm được cấp phát trước khi bước `role-baseline`
 * có trong pipeline, mà không cấp phát lại. Kết nối lấy từ sổ
 * đăng ký control plane (tham chiếu bí mật `env:` → biến môi
 * trường mang URL của kho trung tâm), cùng khuôn với lệnh cấp lại
 * lời mời. Idempotent như bước trong pipeline: kho đã cài trọn
 * bộ vai (có dấu mốc hoàn tất) thì không đổi gì; kho mà lượt
 * cài trước chưa chạy trọn thì lượt này lấp đủ.
 *
 * @param options - Slug của trung tâm.
 * @returns Kết quả lượt cài (xem `SpaceRoleBaselineResult`).
 * @throws Error khi trung tâm chưa đăng ký, không phải trung tâm
 *   kho riêng, chưa có dòng tenant trong kho của nó, hoặc biến môi
 *   trường URL kết nối của trung tâm chưa có trong môi trường
 *   chạy lệnh.
 */
export async function installSpaceRoleBaseline(options: SpaceRoleBaselineOptions): Promise<SpaceRoleBaselineResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? defaultLog;
  const slug = normalizeSpaceSlug(options.slug);
  if (!env.CONTROL_PLANE_DATABASE_URL) throw new Error('CONTROL_PLANE_DATABASE_URL is required');
  const { writer, centreUrl } = await openCentreStore(env, slug);
  try {
    const accessPool = new Pool({ connectionString: centreUrl, max: 1 });
    const accessDb = createCentreKysely(accessPool);
    try {
      // GUC platform ở mức phiên như mọi đường ghi seed vào kho
      // trung tâm: qua được RLS FORCE của kho. Lượt đọc dòng
      // tenant và lượt cài bộ vai dùng chung handle này.
      await enablePlatformGuc(accessDb);
      const tenant = await accessDb.selectFrom('tenants').selectAll()
        .where('slug', '=', slug).limit(1).executeTakeFirst();
      if (!tenant) throw new Error(`Tenant ${slug} does not exist in the centre database yet`);
      const outcome = await installCentreRoleBaseline(accessDb);
      log(`[install-roles:${slug}] role-baseline: ${outcome}`);
      return { slug, outcome };
    } finally {
      await accessDb.destroy().catch(() => undefined);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
}
