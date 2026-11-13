/**
 * Repository của cụm XÁC THỰC trên Kysely.
 *
 * Vai trò: mọi truy cập tới bốn bảng của kho trung tâm thuộc cụm auth (họ refresh token, nhật ký lần thử đăng nhập, liên kết đăng nhập OAuth, bản ghi TOTP) tập trung ở đây. Repository không chứa luật nghiệp vụ — chính sách khoá tài khoản, xoay token, cổng MFA nằm ở tầng service phía ứng dụng; repository chỉ nhận handle Kysely (instance gốc hoặc transaction đang mở) do tầng ứng dụng truyền vào.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Bên trong, truy vấn viết trên interface schema sinh bằng
 *   codegen: tên bảng/cột giữ nguyên snake_case của database.
 * - Bên ngoài, repository trả/nhận hình dạng dòng camelCase như
 *   phía tiêu thụ đang dùng: cột được chọn bằng danh sách tường minh có bí danh (`family_id as familyId`), giá trị ghi được ánh xạ từng trường từ camelCase sang snake_case ở các hàm `*InsertValues` trong file này. Phía tiêu thụ vì vậy chỉ đổi điểm import khi kho chuyển đổi.
 * - Giá trị `undefined` bị LOẠI khỏi values trước khi gọi builder
 *   (quy tắc T-4 của pilot): trường vắng mặt phải để default của
 *   database quyết định. Ngược lại, `undefined` lọt vào mệnh đề
 *   WHERE bị gắn thành NULL lúc thực thi và lặng lẽ trả 0 dòng —
 *   vì vậy mọi giá trị where trong repository đều là tham số bắt buộc.
 * - Repository không import từ `apps/*`, không đọc ALS/ngữ cảnh
 *   ứng dụng, không tự mở pool: handle do tầng ứng dụng dựng (điểm lắp ráp là facade định tuyến theo không gian `routedKysely`) rồi truyền vào; ngữ cảnh trung tâm đi theo chính kết nối của handle đó.
 */
import {sql, type InsertObject} from 'kysely';
import type { CentreDb, CentreDB, CentreTx } from '../client';

/** Handle đọc/ghi mà repository nhận: instance gốc hoặc transaction đang mở. */
export type AuthDb = CentreDb | CentreTx;

/** Một dòng họ refresh token (hình dạng camelCase phía tiêu thụ dùng). */
export interface RefreshFamilyRow {
  id: string;
  familyId: string;
  userId: string;
  /** Tenant hiệu lực của phiên (claim `tid`) — giữ qua refresh, đổi qua switch-tenant. */
  tenantId: string | null;
  ip: string | null;
  userAgent: string | null;
  currentTokenHash: string;
  previousTokenHash: string | null;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  rotatedAt: Date;
}

/**
 * Secret chờ thay thiết bị phải gắn với đúng secret đang hoạt động tại lúc xác thực mã TOTP cũ. Định danh bản active là ciphertext GCM:
 * mỗi lần bật/thay mã hoá với IV ngẫu nhiên, nên reset + bật lại cũng tạo phiên bản khác dù secret thô giả sử trùng.
 */
export interface PendingTotpReplacement {
  secretEncrypted: string;
  activeSecretEncrypted: string;
}

/** Một dòng bản ghi TOTP của user (secret đã mã hoá). */
export interface UserTotpRow {
  id: string;
  userId: string;
  secretEncrypted: string;
  confirmed: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
}

/** Một dòng liên kết đăng nhập ngoài (issuer + định danh chủ thể phía provider). */
export interface UserOauthLinkRow {
  id: string;
  userId: string;
  issuer: string;
  issuerUserId: string;
  email: string;
  createdAt: Date;
}

/** Một dòng nhật ký lần thử đăng nhập. */
export interface LoginAttemptRow {
  id: string;
  userId: string | null;
  username: string;
  success: boolean;
  ip: string | null;
  attemptedAt: Date;
}

/** Dữ kiện tạo một họ refresh token mới (các trường có default ở database được phép vắng mặt). */
export interface NewRefreshFamily {
  id?: string;
  familyId: string;
  userId: string;
  tenantId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  currentTokenHash: string;
  previousTokenHash?: string | null;
  revoked?: boolean;
  expiresAt: Date;
  createdAt?: Date;
  rotatedAt?: Date;
}

/** Dữ kiện tạo một liên kết đăng nhập ngoài. */
export interface NewOauthLink {
  id?: string;
  userId: string;
  issuer: string;
  issuerUserId: string;
  email: string;
  createdAt?: Date;
}

/** Dữ kiện ghi một lần thử đăng nhập. */
export interface NewLoginAttempt {
  id?: string;
  userId?: string | null;
  username: string;
  success: boolean;
  ip?: string | null;
  attemptedAt?: Date;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng họ refresh token (dùng cho cả select lẫn returning). */
const REFRESH_FAMILY_COLUMNS = [
  'id',
  'family_id as familyId',
  'user_id as userId',
  'tenant_id as tenantId',
  'ip',
  'user_agent as userAgent',
  'current_token_hash as currentTokenHash',
  'previous_token_hash as previousTokenHash',
  'revoked',
  'expires_at as expiresAt',
  'created_at as createdAt',
  'rotated_at as rotatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng TOTP. */
const USER_TOTP_COLUMNS = [
  'id',
  'user_id as userId',
  'secret_encrypted as secretEncrypted',
  'confirmed',
  'created_at as createdAt',
  'confirmed_at as confirmedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng liên kết OAuth. */
const USER_OAUTH_LINK_COLUMNS = [
  'id',
  'user_id as userId',
  'issuer',
  'issuer_user_id as issuerUserId',
  'email',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng nhật ký lần thử đăng nhập. */
const LOGIN_ATTEMPT_COLUMNS = [
  'id',
  'user_id as userId',
  'username',
  'success',
  'ip',
  'attempted_at as attemptedAt',
] as const;

/**
 * Ánh xạ dữ kiện tạo họ refresh token (camelCase) sang values insert (snake_case), LOẠI mọi trường mang `undefined` — trường vắng mặt để default của database quyết định (quy tắc T-4).
 */
function refreshFamilyInsertValues(values: NewRefreshFamily): InsertObject<CentreDB, 'refresh_token_family'> {
  const row: InsertObject<CentreDB, 'refresh_token_family'> = {
    family_id: values.familyId,
    user_id: values.userId,
    current_token_hash: values.currentTokenHash,
    expires_at: values.expiresAt,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.tenantId !== undefined) row.tenant_id = values.tenantId;
  if (values.ip !== undefined) row.ip = values.ip;
  if (values.userAgent !== undefined) row.user_agent = values.userAgent;
  if (values.previousTokenHash !== undefined) row.previous_token_hash = values.previousTokenHash;
  if (values.revoked !== undefined) row.revoked = values.revoked;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.rotatedAt !== undefined) row.rotated_at = values.rotatedAt;
  return row;
}

/** Ánh xạ dữ kiện tạo liên kết OAuth (camelCase) sang values insert (snake_case), loại `undefined` như mọi đường ghi khác. */
function oauthLinkInsertValues(values: NewOauthLink): InsertObject<CentreDB, 'user_oauth_links'> {
  const row: InsertObject<CentreDB, 'user_oauth_links'> = {
    user_id: values.userId,
    issuer: values.issuer,
    issuer_user_id: values.issuerUserId,
    email: values.email,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  return row;
}

/** Ánh xạ dữ kiện ghi lần thử đăng nhập (camelCase) sang values insert (snake_case), loại `undefined` như mọi đường ghi khác. */
function loginAttemptInsertValues(values: NewLoginAttempt): InsertObject<CentreDB, 'login_attempts'> {
  const row: InsertObject<CentreDB, 'login_attempts'> = {
    username: values.username,
    success: values.success,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.userId !== undefined) row.user_id = values.userId;
  if (values.ip !== undefined) row.ip = values.ip;
  if (values.attemptedAt !== undefined) row.attempted_at = values.attemptedAt;
  return row;
}

/**
 * Kho dữ liệu phiên xác thực: họ refresh token (token family) và nhật ký lần thử đăng nhập. Mô hình family cho phép phát hiện tái sử dụng refresh token: khi một token đã xoay bị dùng lại, toàn bộ family bị thu hồi.
 */
export class AuthRepository {
  constructor(private readonly handle: AuthDb) {}

  /** Handle gốc của repository (điểm mở giao dịch; mặc định cho tham số `db` của các phương thức). */
  private db(): AuthDb {
    return this.handle;
  }

  /** Tạo family mới cho một lần đăng nhập, lưu hash của refresh token đầu tiên. */
  async createFamily(v: NewRefreshFamily, db: AuthDb = this.db()): Promise<RefreshFamilyRow> {
    return db
      .insertInto('refresh_token_family')
      .values(refreshFamilyInsertValues(v))
      .returning(REFRESH_FAMILY_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Tìm family theo hash refresh token (hash hiện tại hoặc hash trước đó vừa xoay). */
  async getFamilyByHash(tokenHash: string, db: AuthDb = this.db()): Promise<RefreshFamilyRow | undefined> {
    return db
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where((eb) => eb.or([
        eb('current_token_hash', '=', tokenHash),
        eb('previous_token_hash', '=', tokenHash),
      ]))
      .executeTakeFirst();
  }

  /** Tìm family theo `familyId` (claim `sid` của access token). */
  async getFamilyById(familyId: string, db: AuthDb = this.db()): Promise<RefreshFamilyRow | undefined> {
    return db
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where('family_id', '=', familyId)
      .executeTakeFirst();
  }

  /** Cập nhật tenant hiệu lực của family (khi refresh phân giải lại tenant). */
  async setFamilyTenant(id: string, tenantId: string, db: AuthDb = this.db()): Promise<void> {
    await db
      .updateTable('refresh_token_family')
      .set({ tenant_id: tenantId })
      .where('id', '=', id)
      .execute();
  }

  /** Xoay family sang refresh token mới (ghi hash mới, đánh dấu hash cũ đã dùng). */
  async rotateFamily(id: string, currentTokenHash: string, previousTokenHash: string, db: AuthDb = this.db()): Promise<void> {
    await db
      .updateTable('refresh_token_family')
      .set({ current_token_hash: currentTokenHash, previous_token_hash: previousTokenHash, rotated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Thu hồi toàn bộ family (đăng xuất hoặc phát hiện tái sử dụng). */
  async revokeFamily(id: string, db: AuthDb = this.db()): Promise<void> {
    await db
      .updateTable('refresh_token_family')
      .set({ revoked: true })
      .where('id', '=', id)
      .execute();
  }

  /** Thu hồi mọi family của user (đổi mật khẩu, đình chỉ). */
  async revokeAllForUser(userId: string, db: AuthDb = this.db()): Promise<void> {
    await db
      .updateTable('refresh_token_family')
      .set({ revoked: true })
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Các family đang hiệu lực của user (chưa thu hồi, chưa hết hạn) — nguồn cho danh sách "phiên API" ở trang quản lý phiên của chính user.
   */
  async listActiveFamiliesByUser(userId: string, db: AuthDb = this.db()): Promise<RefreshFamilyRow[]> {
    return db
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where('user_id', '=', userId)
      .where('revoked', '=', false)
      .where('expires_at', '>=', new Date())
      .orderBy('created_at', 'desc')
      .execute();
  }

  /**
   * Tìm family theo định danh family công khai (`family_id` — cũng là `sid` trong access token).
   */
  async getFamilyByFamilyId(familyId: string, db: AuthDb = this.db()): Promise<RefreshFamilyRow | undefined> {
    return db
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where('family_id', '=', familyId)
      .executeTakeFirst();
  }

  /**
   * Thu hồi mọi family đang hiệu lực của user ngoại trừ một family giữ lại
   * (phiên hiện tại); trả số family đã thu hồi.
   */
  async revokeOthersForUser(userId: string, keepFamilyId?: string, db: AuthDb = this.db()): Promise<number> {
    const active = await this.listActiveFamiliesByUser(userId, db);
    const targets = active.filter((f) => f.familyId !== keepFamilyId);
    for (const family of targets) await this.revokeFamily(family.id, db);
    return targets.length;
  }

  // --- Liên kết đăng nhập OAuth (auth_oauth2) ------------------------------------

  /**
   * Tạo liên kết đăng nhập ngoài cho user; ràng buộc duy nhất ở DB chặn một tài khoản provider nối hai user hoặc một user hai liên kết/issuer.
   */
  async createOauthLink(v: NewOauthLink, db: AuthDb = this.db()): Promise<UserOauthLinkRow> {
    return db
      .insertInto('user_oauth_links')
      .values(oauthLinkInsertValues(v))
      .returning(USER_OAUTH_LINK_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Tìm liên kết theo tài khoản provider (issuer + định danh chủ thể) — bước khớp đầu tiên ở callback OAuth.
   */
  async getOauthLinkBySubject(issuer: string, issuerUserId: string, db: AuthDb = this.db()): Promise<UserOauthLinkRow | undefined> {
    return db
      .selectFrom('user_oauth_links')
      .select(USER_OAUTH_LINK_COLUMNS)
      .where('issuer', '=', issuer)
      .where('issuer_user_id', '=', issuerUserId)
      .executeTakeFirst();
  }

  /**
   * Mọi liên kết đăng nhập ngoài của user, cũ nhất trước (trang Linked logins).
   */
  async listOauthLinksByUser(userId: string, db: AuthDb = this.db()): Promise<UserOauthLinkRow[]> {
    return db
      .selectFrom('user_oauth_links')
      .select(USER_OAUTH_LINK_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /**
   * Tìm liên kết theo id (kèm userId ở phía gọi để kiểm tra sở hữu trước khi gỡ).
   */
  async getOauthLinkById(id: string, db: AuthDb = this.db()): Promise<UserOauthLinkRow | undefined> {
    return db
      .selectFrom('user_oauth_links')
      .select(USER_OAUTH_LINK_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Xoá một liên kết đăng nhập ngoài (gỡ liên kết ở trang Linked logins).
   */
  async deleteOauthLink(id: string, db: AuthDb = this.db()): Promise<void> {
    await db.deleteFrom('user_oauth_links').where('id', '=', id).execute();
  }

  // --- MFA TOTP ---------------------------------------------------------------

  /**
   * Bản ghi TOTP của user (secret đã mã hoá), hoặc undefined nếu chưa setup.
   */
  async getTotpByUserId(userId: string, db: AuthDb = this.db()): Promise<UserTotpRow | undefined> {
    return db
      .selectFrom('user_totp')
      .select(USER_TOTP_COLUMNS)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  /**
   * Ghi secret TOTP cho lần bật đầu tiên hoặc setup lại khi factor vẫn chưa xác nhận. Với factor đã bật, caller phải dùng stageTotpReplacement() để giữ trạng thái confirmed và secret cũ.
   */
  async upsertPendingTotp(userId: string, secretEncrypted: string, db: AuthDb = this.db()): Promise<UserTotpRow | undefined> {
    // Nếu confirm thắng cuộc đua, WHERE bảo vệ factor active và RETURNING rỗng để service báo 409, không lộ secret chưa lưu.
    return db
      .insertInto('user_totp')
      .values({ user_id: userId, secret_encrypted: secretEncrypted, confirmed: false, confirmed_at: null })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({
        secret_encrypted: secretEncrypted,
        confirmed: false,
        confirmed_at: null,
        created_at: new Date(),
      }).where('user_totp.confirmed', '=', false))
      .returning(USER_TOTP_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Chờ thay thiết bị: chấp nhận secret mới chỉ nếu factor đang bật
   * VẪN là factor đã xác thực mã TOTP cũ. Mọi thao tác stage/confirm
   * giữ advisory lock theo pending identifier rồi khóa hàng active;
   * không thể dùng mã A cũ để stage B sau khi A đã chuyển thành C.
   *
   * @param userId Chủ thể đang thay ứng dụng xác thực.
   * @param secretEncrypted Secret mới đã mã hoá GCM.
   * @param activeSecretEncrypted Ciphertext của factor được kiểm mã cũ.
   * @returns false nếu trạng thái active đã đổi, bị tắt hoặc admin reset.
   */
  async stageTotpReplacement(
    userId: string,
    secretEncrypted: string,
    activeSecretEncrypted: string,
  ): Promise<boolean> {
    const identifier = 'totp-replace-' + userId;
    const expiresAt = new Date(Date.now() + 600_000);
    return this.handle.transaction().execute(async (trx) => {
      // Khóa theo thứ tự chung: pending key -> active row. verification.identifier không UNIQUE, nên không dùng UPSERT.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const active = await trx.selectFrom('user_totp')
        .select(['secret_encrypted', 'confirmed'])
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!active?.confirmed || active.secret_encrypted !== activeSecretEncrypted) return false;

      const payload: PendingTotpReplacement = { secretEncrypted, activeSecretEncrypted };
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
      await trx.insertInto('verification')
        .values({ identifier, value: JSON.stringify(payload), expires_at: expiresAt }).execute();
      return true;
    });
  }

  /**
   * Đọc pending còn hạn và phiên bản active đã được kiểm mã cũ.
   * Dòng cũ không có thông tin nguồn bị từ chối để fail-closed.
   * @param userId Chủ thể của pending replacement.
   * @returns Secret chờ cùng phiên bản active nguồn, hoặc undefined.
   */
  async getPendingTotpReplacement(userId: string, db: AuthDb = this.db()): Promise<PendingTotpReplacement | undefined> {
    const row = await db.selectFrom('verification')
      .select(['value', 'expires_at'])
      .where('identifier', '=', 'totp-replace-' + userId)
      .executeTakeFirst();
    if (!row || row.expires_at <= new Date()) return undefined;
    try {
      const payload: unknown = JSON.parse(row.value);
      if (!payload || typeof payload !== 'object') return undefined;
      const candidate = payload as Partial<PendingTotpReplacement>;
      if (typeof candidate.secretEncrypted !== 'string' ||
          typeof candidate.activeSecretEncrypted !== 'string' ||
          !candidate.secretEncrypted || !candidate.activeSecretEncrypted) return undefined;
      return {
        secretEncrypted: candidate.secretEncrypted,
        activeSecretEncrypted: candidate.activeSecretEncrypted,
      };
    } catch {
      // Pending lưu bởi phiên bản cũ không ràng buộc active: buộc setup lại.
      return undefined;
    }
  }

  /**
   * Chỉ hoán đổi factor nếu pending chưa bị thay và active VẪN đúng
   * phiên bản được xác thực lúc stage. Khoá và so sánh thực hiện chung
   * trong transaction, cả khi có admin reset/re-enable hoặc setup khác.
   *
   * @param userId User đang xác nhận thiết bị mới.
   * @param candidate Pending đã được service kiểm mã thiết bị mới.
   * @returns true khi pending và phiên bản active đều khớp.
   */
  async activateTotpReplacement(userId: string, candidate: PendingTotpReplacement): Promise<boolean> {
    return this.handle.transaction().execute(async (trx) => {
      const identifier = 'totp-replace-' + userId;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const pending = await trx.selectFrom('verification')
        .select(['value', 'expires_at'])
        .where('identifier', '=', identifier)
        .forUpdate()
        .executeTakeFirst();
      if (!pending || pending.value !== JSON.stringify(candidate) || pending.expires_at <= new Date()) {
        return false;
      }
      // CAS trên ciphertext active, không chỉ confirmed=true: mã A cũ
      // không thể xác nhận B nếu A đã đổi thành C từ lúc stage.
      const active = await trx.updateTable('user_totp')
        .set({ secret_encrypted: candidate.secretEncrypted, confirmed: true, confirmed_at: new Date() })
        .where('user_id', '=', userId)
        .where('confirmed', '=', true)
        .where('secret_encrypted', '=', candidate.activeSecretEncrypted)
        .returning('user_id')
        .executeTakeFirst();
      if (!active) return false;
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
      return true;
    });
  }

  /** Xoá pending replacement khi user tắt MFA hoặc quản trị reset factor. */
  async clearPendingTotpReplacement(userId: string, db: AuthDb = this.db()): Promise<void> {
    await db.deleteFrom('verification')
      .where('identifier', '=', 'totp-replace-' + userId)
      .execute();
  }

  /**
   * Kích hoạt đúng secret mà service đã kiểm mã TOTP, với CAS atomically.
   * Nếu setup khác vừa ghi secret, không bật nhầm factor chưa được
   * xác minh. Nếu confirm khác đã thắng, trả false để client thử lại.
   *
   * @param userId User đang thiết lập MFA.
   * @param encryptedSecret Secret đã đọc trước khi xác minh mã.
   * @returns true khi đã xác nhận chính xác factor đó.
   */
  async confirmTotp(userId: string, encryptedSecret: string, db: AuthDb = this.db()): Promise<boolean> {
    const row = await db
      .updateTable('user_totp')
      .set({ confirmed: true, confirmed_at: new Date() })
      .where('user_id', '=', userId)
      .where('secret_encrypted', '=', encryptedSecret)
      .where('confirmed', '=', false)
      .returning('user_id')
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * Người dùng tự tắt MFA chỉ khi factor hiện tại vẫn là bản đã được
   * kiểm mã; reset/hoán đổi xảy ra trước đó phải làm yêu cầu thất bại.
   * Xoá pending cùng transaction để không giữ secret chờ bị mồ côi.
   *
   * @param userId Tài khoản tự tắt MFA.
   * @param activeSecretEncrypted Bản active được kiểm mã TOTP ở service.
   * @returns false khi active đã đổi hoặc không còn tồn tại.
   */
  async disableTotpIfMatches(userId: string, activeSecretEncrypted: string): Promise<boolean> {
    const identifier = 'totp-replace-' + userId;
    return this.handle.transaction().execute(async (trx) => {
      // Dùng cùng thứ tự khoá như stage/activate: pending -> active.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const removed = await trx.deleteFrom('user_totp')
        .where('user_id', '=', userId)
        .where('confirmed', '=', true)
        .where('secret_encrypted', '=', activeSecretEncrypted)
        .returning('user_id')
        .executeTakeFirst();
      if (!removed) return false;
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
      return true;
    });
  }

  /**
   * Quản trị reset factor không đòi mã TOTP nhưng phải huỷ luôn mọi
   * pending replacement trong cùng transaction. Lock cùng thứ tự
   * stage/activate để request cũ không hồi sinh pending sau reset.
   *
   * @param userId User được quản trị viên reset.
   */
  async deleteTotp(userId: string): Promise<void> {
    const identifier = 'totp-replace-' + userId;
    await this.handle.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      await trx.deleteFrom('user_totp').where('user_id', '=', userId).execute();
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
    });
  }

  /**
   * Ghi một lần thử đăng nhập (thành công/thất bại, IP) phục vụ khoá tạm thời.
   */
  async recordAttempt(v: NewLoginAttempt, db: AuthDb = this.db()): Promise<void> {
    await db.insertInto('login_attempts').values(loginAttemptInsertValues(v)).execute();
  }

  /**
   * Số lần đăng nhập thất bại gần đây của username — đầu vào của chính sách lockout.
   */
  async recentFailedAttempts(userId: string, since: Date, db: AuthDb = this.db()): Promise<LoginAttemptRow[]> {
    return db
      .selectFrom('login_attempts')
      .select(LOGIN_ATTEMPT_COLUMNS)
      .where('user_id', '=', userId)
      .where('success', '=', false)
      .where('attempted_at', '>=', since)
      .orderBy('attempted_at', 'desc')
      .execute();
  }

  /**
   * Thời điểm đăng nhập thành công gần nhất.
   */
  async lastSuccessfulAttemptAt(userId: string, db: AuthDb = this.db()): Promise<Date | undefined> {
    const row = await db
      .selectFrom('login_attempts')
      .select(LOGIN_ATTEMPT_COLUMNS)
      .where('user_id', '=', userId)
      .where('success', '=', true)
      .orderBy('attempted_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.attemptedAt;
  }
}
