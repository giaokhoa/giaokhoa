/**
 * Repository của cụm TENANT trên Kysely.
 *
 * Vai trò: mọi truy cập tới ba bảng `tenants`, `tenant_memberships` và `tenant_config` của kho trung tâm tập trung ở đây. Thuần dữ liệu — mọi quyết định quyền nằm ở TenantsService / PermissionEvaluator phía ứng dụng; repository chỉ nhận handle Kysely do tầng ứng dụng truyền vào.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Bên trong, truy vấn viết trên interface schema sinh bằng
 *   codegen: tên bảng/cột giữ nguyên snake_case của database.
 * - Bên ngoài, repository trả/nhận hình dạng dòng camelCase như
 *   phía tiêu thụ đang dùng: cột được chọn bằng danh sách tường minh có bí danh (`tenant_id as tenantId`), giá trị ghi được ánh xạ từng trường từ camelCase sang snake_case ở các hàm `*InsertValues`/`*UpdateSet` trong file này.
 * - Giá trị `undefined` bị LOẠI khỏi values/set trước khi gọi
 *   builder (quy tắc T-4 của pilot): trường vắng mặt phải để default của database quyết định; mọi giá trị where đều là tham số bắt buộc.
 * - Giá trị jsonb (`tenant_config.value`) ghi qua helper
 *   serialize + ép kiểu `::jsonb` (mẫu `jsonbValue` của pilot):
 *   driver `pg` hiểu một MẢNG ở cấp cao nhất là mảng PostgreSQL chứ không phải JSON, nên serialize tường minh cho mọi hình dạng giá trị; giá trị `null` giữ nguyên là SQL NULL như đường bộ máy cũ trước đây.
 * - Repository không import từ `apps/*`, không đọc ALS/ngữ cảnh
 *   ứng dụng, không tự mở pool: handle do tầng ứng dụng dựng (điểm lắp ráp là facade định tuyến theo không gian `routedKysely`) rồi truyền vào; ngữ cảnh trung tâm đi theo chính kết nối của handle đó.
 */
import {type InsertObject, type UpdateObject} from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

/** Handle đọc/ghi mà repository nhận: instance gốc hoặc transaction đang mở của kho trung tâm. */
export type TenantsDb = CentreDb | CentreTx;
import type { Json } from '../types/centre-db';
import { jsonbValue } from '../jsonb';

/** Một dòng tenant (hình dạng camelCase phía tiêu thụ dùng). */
export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  plan: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng membership của tenant. */
export interface TenantMembershipRow {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
  joinedAt: Date;
  endedAt: Date | null;
}

/** Một dòng cấu hình theo tenant; `value` là jsonb tự do nên giữ kiểu `unknown` như đường cũ trước đây. */
export interface TenantConfigRow {
  id: string;
  tenantId: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}

/** Dữ kiện tạo tenant mới (các trường có default ở database được phép vắng mặt). */
export interface NewTenant {
  id?: string;
  slug: string;
  name: string;
  kind: string;
  status?: string;
  plan?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện tạo membership mới. */
export interface NewTenantMembership {
  id?: string;
  tenantId: string;
  userId: string;
  status?: string;
  joinedAt?: Date;
  endedAt?: Date | null;
}

/** Slug của tenant-zero — không gian Trang chính (giáo viên/học sinh tự do). */
export const PLATFORM_TENANT_SLUG = 'trang-chinh';
/** Slug của tenant trường mặc định do review-seed dựng cho câu chuyện demo. */
export const DEFAULT_SCHOOL_TENANT_SLUG = 'truong-mac-dinh';

/** Danh sách cột tường minh có bí danh camelCase cho bảng tenant (dùng cho cả select lẫn returning). */
const TENANT_COLUMNS = [
  'id',
  'slug',
  'name',
  'kind',
  'status',
  'plan',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng membership. */
const TENANT_MEMBERSHIP_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'user_id as userId',
  'status',
  'joined_at as joinedAt',
  'ended_at as endedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng cấu hình tenant. */
const TENANT_CONFIG_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'key',
  'value',
  'updated_at as updatedAt',
] as const;

/**
 * Ánh xạ dữ kiện tạo tenant (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined` (quy tắc T-4).
 */
function tenantInsertValues(values: NewTenant): InsertObject<CentreDB, 'tenants'> {
  const row: InsertObject<CentreDB, 'tenants'> = {
    slug: values.slug,
    name: values.name,
    kind: values.kind,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.plan !== undefined) row.plan = values.plan;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

/**
 * Ánh xạ một patch tenant (camelCase, lấy theo hình dạng dòng đầy
 * đủ) sang set update (snake_case), LOẠI mọi trường `undefined` —
 * patch chỉ chứa trường nào thì chỉ trường đó đổi (quy tắc T-4).
 * Mốc `updated_at` do repository tự đóng dấu ở điểm gọi.
 */
function tenantUpdateSet(patch: Partial<TenantRow>): UpdateObject<CentreDB, 'tenants'> {
  const set: UpdateObject<CentreDB, 'tenants'> = {};
  if (patch.slug !== undefined) set.slug = patch.slug;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.plan !== undefined) set.plan = patch.plan;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

/** Ánh xạ dữ kiện tạo membership (camelCase) sang values insert (snake_case), loại `undefined` như mọi đường ghi khác. */
function membershipInsertValues(values: NewTenantMembership): InsertObject<CentreDB, 'tenant_memberships'> {
  const row: InsertObject<CentreDB, 'tenant_memberships'> = {
    tenant_id: values.tenantId,
    user_id: values.userId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.joinedAt !== undefined) row.joined_at = values.joinedAt;
  if (values.endedAt !== undefined) row.ended_at = values.endedAt;
  return row;
}

/**
 * Ánh xạ một patch membership (camelCase) sang set update
 * (snake_case), LOẠI mọi trường `undefined` (quy tắc T-4). Bảng
 * membership không có mốc `updated_at` nên repository không đóng
 * dấu mốc nào ở đường cập nhật này — đúng hành vi đường bộ máy cũ
 * trước đây.
 */
function membershipUpdateSet(patch: Partial<TenantMembershipRow>): UpdateObject<CentreDB, 'tenant_memberships'> {
  const set: UpdateObject<CentreDB, 'tenant_memberships'> = {};
  if (patch.tenantId !== undefined) set.tenant_id = patch.tenantId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.joinedAt !== undefined) set.joined_at = patch.joinedAt;
  if (patch.endedAt !== undefined) set.ended_at = patch.endedAt;
  return set;
}

/**
 * Kho dữ liệu tenant: vòng đời tenant, membership và cấu hình theo tenant.
 * Thuần dữ liệu — mọi quyết định quyền nằm ở TenantsService /
 * PermissionEvaluator.
 */
export class TenantsRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Handle gốc của repository (điểm mở giao dịch; mặc định cho tham số `db` của các phương thức). */
  private db(): TenantsDb {
    return this.handle;
  }

  /** Handle Kysely định tuyến theo không gian của repository, dùng khi caller cần ghép truy vấn vào cùng kho. */
  get dbHandle(): CentreDb { return this.handle; }

  async insertTenant(v: NewTenant, db: TenantsDb = this.db()): Promise<TenantRow> {
    return db
      .insertInto('tenants')
      .values(tenantInsertValues(v))
      .returning(TENANT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getTenant(id: string, db: TenantsDb = this.db()): Promise<TenantRow | undefined> {
    return db
      .selectFrom('tenants')
      .select(TENANT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getTenantBySlug(slug: string, db: TenantsDb = this.db()): Promise<TenantRow | undefined> {
    return db
      .selectFrom('tenants')
      .select(TENANT_COLUMNS)
      .where('slug', '=', slug)
      .executeTakeFirst();
  }

  /** Bản tenant-zero đã tra được, giữ trong singleton của repository. */
  private platformTenantCache: TenantRow | undefined;

  /**
   * Tenant-zero (tenant nền tảng) cho TenantGuard: được gieo một lần
   * lúc bootstrap và không đổi danh tính (id/slug/kind) trong vòng
   * đời tiến trình, nên tra một lần rồi giữ lại trong singleton này
   * — bỏ một truy vấn khỏi MỌI request. Chỉ cache khi ĐÃ tra thấy:
   * trước bootstrap seed (tenant-zero chưa tồn tại) mọi lần gọi vẫn
   * xuống cơ sở dữ liệu để request đầu tiên sau khi gieo thấy ngay.
   * Các thay đổi trạng thái/cấu hình của tenant-zero không đi qua
   * bản cache này (guard chỉ dùng `id` của nó làm tenant hiệu lực
   * mặc định); đường đọc cần trạng thái tươi dùng `getTenantBySlug` /
   * `getTenant` như cũ.
   */
  async getPlatformTenant(db: TenantsDb = this.db()): Promise<TenantRow | undefined> {
    if (!this.platformTenantCache) {
      this.platformTenantCache = await this.getTenantBySlug(PLATFORM_TENANT_SLUG, db);
    }
    return this.platformTenantCache;
  }

  async listTenants(db: TenantsDb = this.db()): Promise<TenantRow[]> {
    return db
      .selectFrom('tenants')
      .select(TENANT_COLUMNS)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async updateTenant(id: string, patch: Partial<TenantRow>, db: TenantsDb = this.db()): Promise<void> {
    await db
      .updateTable('tenants')
      .set({ ...tenantUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertMembership(v: NewTenantMembership, db: TenantsDb = this.db()): Promise<TenantMembershipRow> {
    return db
      .insertInto('tenant_memberships')
      .values(membershipInsertValues(v))
      .returning(TENANT_MEMBERSHIP_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getMembership(tenantId: string, userId: string, db: TenantsDb = this.db()): Promise<TenantMembershipRow | undefined> {
    return db
      .selectFrom('tenant_memberships')
      .select(TENANT_MEMBERSHIP_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  async listMembershipsForUser(userId: string, db: TenantsDb = this.db()): Promise<TenantMembershipRow[]> {
    return db
      .selectFrom('tenant_memberships')
      .select(TENANT_MEMBERSHIP_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('joined_at', 'asc')
      .execute();
  }

  async listMembershipsForTenant(tenantId: string, db: TenantsDb = this.db()): Promise<TenantMembershipRow[]> {
    return db
      .selectFrom('tenant_memberships')
      .select(TENANT_MEMBERSHIP_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .orderBy('joined_at', 'asc')
      .execute();
  }

  async updateMembership(id: string, patch: Partial<TenantMembershipRow>, db: TenantsDb = this.db()): Promise<void> {
    await db
      .updateTable('tenant_memberships')
      .set(membershipUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async getConfigValue(tenantId: string, key: string, db: TenantsDb = this.db()): Promise<TenantConfigRow | undefined> {
    const row = await db
      .selectFrom('tenant_config')
      .select(TENANT_CONFIG_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('key', '=', key)
      .executeTakeFirst();
    return row as TenantConfigRow | undefined;
  }

  async listConfigForTenant(tenantId: string, db: TenantsDb = this.db()): Promise<TenantConfigRow[]> {
    const rows = await db
      .selectFrom('tenant_config')
      .select(TENANT_CONFIG_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .execute();
    return rows as TenantConfigRow[];
  }

  async upsertConfigValue(tenantId: string, key: string, value: unknown, db: TenantsDb = this.db()): Promise<void> {
    const stored = value === null || value === undefined ? null : jsonbValue(value);
    await db
      .insertInto('tenant_config')
      .values({ tenant_id: tenantId, key, value: stored })
      .onConflict((oc) => oc.columns(['tenant_id', 'key']).doUpdateSet({
        value: stored,
        updated_at: new Date(),
      }))
      .execute();
  }

  async deleteConfigValue(tenantId: string, key: string, db: TenantsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('tenant_config')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', key)
      .execute();
  }
}
