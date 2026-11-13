/**
 * Hoàn tất bước hai của đăng nhập Better Auth (endpoint `/auth/two-factor/verify-totp` và `/auth/two-factor/verify-backup-code` ở tầng Nest — mount chừa segment `two-factor` cho Nest, xem `better-auth.mount.ts`).
 *
 * Vì sao bước hoàn tất nằm ở đây thay vì plugin twoFactor của Better Auth: xem khối plugins trong `better-auth.instance.ts` (plugin đòi trường user `twoFactorEnabled` không có trong ánh xạ của hệ và sẽ dựng nguồn trạng thái MFA thứ hai). Ở đây trạng thái MFA và việc kiểm mã đều đi qua MỘT nguồn duy nhất là `user_totp` qua `TotpService` của module auth — cùng cơ chế verify mà các luồng đăng nhập tự viết dùng.
 *
 * Giao thức với cổng MFA (`mfa-gate.ts`) — cổng phát, nơi này tiêu thụ, đúng định dạng plugin twoFactor của better-auth@1.7.12 tự dùng nên semantics hai phía khớp nhau:
 *
 * - Cookie ký `better-auth.two_factor` (tên lấy từ createAuthCookie
 *   của chính instance) chứa identifier của challenge; chữ ký HMAC kiểm bằng secret của instance (`makeSignature` + `constantTimeEqual` của `better-auth/crypto`).
 * - Dòng verification `2fa-<id>` → userId, hạn 600 giây; dòng
 *   `2fa-attempts-<id>` đếm số lần thử SAI của challenge đó, ngân sách 5 lần: mỗi lần verify đều TIÊU THỤ cả hai dòng trước; sai mã thì dựng lại dòng attempts với đếm +1 (cùng hạn của challenge), hết ngân sách thì challenge bị huỷ và bị từ chối bằng `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` — người dùng phải đăng nhập lại để có challenge mới.
 * - Mã đúng: challenge đã tiêu thụ (không chơi lại được), phiên
 *   được tạo qua cầu nối phiên lập trình (cùng cơ chế login-as tạo phiên Better Auth ngoài handler) và cookie phiên được đặt theo đúng thuộc tính cookie của instance; cookie chờ bước hai bị xoá. Người dùng bị đình chỉ vẫn nhận phiên ở bước này như semantics của Better Auth — guard phiên chặn mọi route nghiệp vụ của tài khoản đình chỉ ngay sau đó.
 * - Kiểm Origin như handler Better Auth làm với POST mang cookie:
 *   Origin có mặt mà không thuộc origins tin cậy của instance thì 403 trước mọi xử lý.
 * - Mã dự phòng: sản phẩm không có khái niệm mã dự phòng (factor
 *   TOTP của hệ tự viết không phát mã dự phòng) nên endpoint verify-backup-code luôn từ chối bằng `INVALID_BACKUP_CODE` — nhưng vẫn qua cùng cửa challenge + đếm lần thử để không thành một lối dò riêng.
 * - Thiết bị tin cậy (trust device): cổng có tôn trọng cookie tin
 *   cậy nếu tồn tại, nhưng bước hoàn tất này KHÔNG phát cookie tin cậy mới — giao diện không có tuỳ chọn "tin cậy thiết bị này", phát dấu mà người dùng không hề chọn sẽ là nới lỏng âm thầm.
 */
import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { constantTimeEqual, makeSignature } from 'better-auth/crypto';
import { createHash } from 'node:crypto';
import { sql, type CentreTx } from '@giaokhoa/db';
import { clientIpOf } from '../../../common/client-ip';
import type { Request } from 'express';
import type { CentreDb } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import { TotpService } from '../totp.service';
import { BetterAuthService } from './better-auth.service';
import { CredentialBridgeService } from './credential-bridge.service';

/** Ngân sách lần thử sai cho một challenge — khớp `beginAttempt(5)` của plugin twoFactor 1.7.12. */
const MAX_CHALLENGE_ATTEMPTS = 5;
/** Ngân sách MFA độc lập với từng challenge, dùng kho verification chung giữa các API instance. */
const MFA_WINDOW_MS = 20 * 60_000;
const MAX_USER_MFA_FAILURES = 10;
// Ngưỡng IP cao để không khoá nhầm nhiều học viên trong cùng NAT trường học.
const MAX_IP_MFA_FAILURES = 500;
/** Tên cookie chờ bước hai trong createAuthCookie của instance (khớp cổng MFA). */
const TWO_FACTOR_COOKIE_NAME = 'two_factor';

/** Lỗi hoàn tất mang đúng hình lỗi của Better Auth: HTTP status + thân `{ code, message }`. */
export class TwoFactorCompletionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TwoFactorCompletionError';
  }
}

/** Trạng thái commit của một lần MFA, trước khi phát cookie ở HTTP. */
type AttemptResult = 'valid' | 'invalid' | 'exhausted' | 'invalid-cookie' | 'unavailable';

/** Kết quả hoàn tất thành công: thông tin đặt cookie phiên + thân đáp ứng cho client. */
export interface TwoFactorCompletionResult {
  sessionCookieName: string;
  sessionCookieValue: string;
  sessionCookieAttributes: Record<string, unknown>;
  sessionExpiresAt: Date;
  twoFactorCookieName: string;
  twoFactorCookieAttributes: Record<string, unknown>;
  body: { token: string; user: Record<string, unknown> };
}

/** Challenge đã giải từ cookie chờ: định danh, chủ sở hữu và hạn dùng. */
interface ResolvedChallenge {
  identifier: string;
  userId: string;
  expiresAt: Date;
  twoFactorCookieName: string;
  twoFactorCookieAttributes: Record<string, unknown>;
}

@Injectable()
export class TwoFactorCompletionService {
  /**
   * Facade Kysely định tuyến theo trung tâm (issue #654, D2): giữ tham chiếu tới facade là an toàn — facade tự phân giải kho đích theo ngữ cảnh ALS tại mỗi lần gọi, không phải ảnh chụp kho tại thời điểm dựng service. Bảng `verification` của codegen CentreDB thay cho bảng bóng bộ máy cũ đã xoá (cùng cột: identifier, value, expires_at; id do DB sinh — các lần chèn ở đây không khai id).
   */
  private readonly db: CentreDb;

  constructor(
    spaceDb: SpaceDatabaseService,
    private readonly betterAuth: BetterAuthService,
    private readonly bridge: CredentialBridgeService,
    // Cùng khuôn phụ thuộc với BetterAuthService: AuthModule xuất TotpService qua vòng forwardRef; thiếu phụ thuộc (chỉ xảy ra khi module bị dựng dở) thì mọi verify bị từ chối fail-closed ở completeTotp thay vì cho qua.
    @Optional()
    @Inject(forwardRef(() => TotpService))
    private readonly totp?: TotpService,
  ) {
    this.db = spaceDb.routedKysely;
  }

  /**
   * Kiểm mã TOTP của bước hai và cấp phiên khi mã đúng.
   *
   * @param req Request thô (đọc cookie chờ + Origin).
   * @param code Mã 6 số người dùng nhập.
   * @returns Kết quả để controller đặt cookie phiên và trả thân.
   * @throws TwoFactorCompletionError với mã lỗi theo ngữ nghĩa
   *   Better Auth khi challenge không hợp lệ/hết hạn/hết ngân sách
   *   hoặc mã sai.
   */
  async verifyTotp(req: Request, code: string): Promise<TwoFactorCompletionResult> {
    const challenge = await this.resolveChallenge(req);
    const result = await this.runChallengeAttempt(
      challenge,
      clientIpOf(req),
      async () => {
        if (!this.totp) throw new Error('TOTP service unavailable');
        return this.totp.verifyForUser(challenge.userId, code);
      },
    );
    if (result === 'valid') return this.issueSession(challenge);
    this.throwForAttempt(result, 'INVALID_CODE');
  }

  /**
   * Mã dự phòng: sản phẩm không phát mã dự phòng nên luôn từ chối.
   * Vẫn tiêu thụ đúng ngân sách cùng luồng TOTP; không mở đường dò riêng.
   * @param req Request mang challenge do primary authentication phát.
   */
  async verifyBackupCode(req: Request): Promise<never> {
    const challenge = await this.resolveChallenge(req);
    const result = await this.runChallengeAttempt(
      challenge,
      clientIpOf(req),
      async () => false,
    );
    this.throwForAttempt(result, 'INVALID_BACKUP_CODE');
  }

  /**
   * Ánh xạ kết quả giao dịch thành mã lỗi ở biên HTTP. Ném lỗi SAU
   * commit để lượt sai vẫn được lưu và budget không bị rollback.
   * @param result Trạng thái sau xác minh trong transaction.
   * @param invalidCode Mã lỗi riêng cho TOTP/backup-code.
   */
  private throwForAttempt(result: AttemptResult, invalidCode: 'INVALID_CODE' | 'INVALID_BACKUP_CODE'): never {
    if (result === 'invalid') {
      throw new TwoFactorCompletionError(invalidCode === 'INVALID_CODE' ? 401 : 400, invalidCode, 'Invalid code');
    }
    if (result === 'exhausted') {
      throw new TwoFactorCompletionError(400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'Too many attempts. Please request a new code.');
    }
    if (result === 'unavailable') {
      throw new TwoFactorCompletionError(500, 'mfa_status_unavailable', 'Could not verify multi-factor authentication status');
    }
    throw new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
  }

  /**
   * Giải challenge từ cookie chờ: kiểm Origin, chữ ký cookie, hạn dùng và sự tồn tại của dòng verification. Mọi bất thường đều là `INVALID_TWO_FACTOR_COOKIE` (401) như plugin — không phân biệt "không có cookie" với "chữ ký sai" với "đã hết hạn" để không lộ trạng thái challenge.
   */
  private async resolveChallenge(req: Request): Promise<ResolvedChallenge> {
    let auth: ReturnType<BetterAuthService['requireAuth']>;
    try {
      auth = this.betterAuth.requireAuth();
    } catch {
      throw new TwoFactorCompletionError(404, 'NOT_FOUND', 'Not found');
    }
    const ctx = await auth.$context;
    const cookieAttrs = ctx.createAuthCookie(TWO_FACTOR_COOKIE_NAME, { maxAge: 600 });
    // Kiểm Origin như handler Better Auth: Origin có mặt phải thuộc origins tin cậy (gồm origin của baseURL) — chặn POST chéo origin mang cookie chờ.
    const origin = req.headers.origin;
    if (origin) {
      const trustedOrigins = ctx.options.trustedOrigins ?? [];
      let baseOrigin: string | null;
      try {
        baseOrigin = new URL(ctx.baseURL).origin;
      } catch {
        baseOrigin = null;
      }
      if (origin !== baseOrigin && !trustedOrigins.includes(origin)) {
        throw new TwoFactorCompletionError(403, 'FORBIDDEN', 'Forbidden');
      }
    }
    const invalid = () =>
      new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
    const rawCookie = cookieValueOf(req, cookieAttrs.name);
    if (!rawCookie) throw invalid();
    const dot = rawCookie.lastIndexOf('.');
    if (dot <= 0) throw invalid();
    const identifier = rawCookie.slice(0, dot);
    const signature = rawCookie.slice(dot + 1);
    const expected = await makeSignature(identifier, ctx.secret);
    if (!constantTimeEqual(Buffer.from(signature), Buffer.from(expected))) throw invalid();
    if (!identifier.startsWith('2fa-')) throw invalid();
    const pending = await this.db
      .selectFrom('verification')
      .selectAll()
      .where('identifier', '=', identifier)
      .limit(1)
      .executeTakeFirst();
    if (!pending || pending.expires_at <= new Date()) throw invalid();
    return {
      identifier,
      userId: pending.value,
      expiresAt: pending.expires_at,
      twoFactorCookieName: cookieAttrs.name,
      twoFactorCookieAttributes: cookieAttrs.attributes as Record<string, unknown>,
    };
  }

  /**
   * Xác minh challenge + ngân sách toàn cục trên MỘT transaction:
   *
   * 1. Khoá user/IP bằng advisory transaction lock theo thứ tự cố định
   *    để nhiều API instance không cùng vượt ngân sách.
   * 2. Đọc lại challenge VÀ số lần thử đang sống dưới row lock,
   *    tuyệt đối không dùng snapshot trước khi đợi khoá.
   * 3. Mã sai: tăng cả budget và attempts trong cùng transaction.
   *    Mã đúng: tiêu thụ cả challenge và attempts cùng transaction.
   * 4. Khi verify lỗi kỹ thuật: không ghi lượt thử hay budget;
   *    khi budget hết: trả 429 trước khi kiểm mã.
   *
   * Giao dịch giữ khoá qua phép kiểm TOTP ngắn, nhưng KHÔNG qua bước
   * tạo phiên. Phiên chỉ được cấp sau khi commit thành công.
   *
   * @param challenge Challenge có cookie ký đã kiểm tra.
   * @param ip IP được lấy theo trusted proxy.
   * @param verifyFactor Hàm kiểm TOTP (false cố định cho backup-code).
   * @returns Trạng thái được commit, không phải một kết quả từ snapshot cũ.
   */
  private async runChallengeAttempt(
    challenge: ResolvedChallenge,
    ip: string | undefined,
    verifyFactor: () => Promise<boolean>,
  ): Promise<AttemptResult> {
    return this.db.transaction().execute(async (trx) => {
      const budgets = this.budgetKeys(challenge.userId, ip);
      for (const budget of budgets) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${budget.identifier}))`.execute(trx);
      }
      for (const budget of budgets) {
        const current = await trx.selectFrom('verification')
          .select(['value', 'expires_at'])
          .where('identifier', '=', budget.identifier)
          .executeTakeFirst();
        if (current && current.expires_at > new Date() && Number(current.value) >= budget.limit) {
          throw new TwoFactorCompletionError(429, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'Too many attempts. Please try again later.');
        }
      }

      const pending = await trx.selectFrom('verification')
        .select(['id', 'value', 'expires_at'])
        .where('identifier', '=', challenge.identifier)
        .forUpdate()
        .executeTakeFirst();
      if (!pending || pending.value !== challenge.userId || pending.expires_at <= new Date()) {
        return 'invalid-cookie';
      }
      const attemptsRow = await trx.selectFrom('verification')
        .select(['id', 'value'])
        .where('identifier', '=', '2fa-attempts-' + challenge.identifier)
        .forUpdate()
        .executeTakeFirst();
      const parsed = attemptsRow ? Number(attemptsRow.value) : Number.NaN;
      const attempts = Number.isInteger(parsed) && parsed >= 0 ? parsed : MAX_CHALLENGE_ATTEMPTS;
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
        await trx.deleteFrom('verification').where('id', '=', pending.id).execute();
        if (attemptsRow) await trx.deleteFrom('verification').where('id', '=', attemptsRow.id).execute();
        return 'exhausted';
      }

      let valid: boolean;
      try {
        valid = await verifyFactor();
      } catch {
        // Không kết luận được thì không chạm attempts hoặc budget.
        return 'unavailable';
      }
      if (!valid) {
        await this.recordMfaFailure(trx, budgets);
        await trx.updateTable('verification')
          .set({ value: String(attempts + 1) })
          .where('id', '=', attemptsRow!.id)
          .execute();
        return 'invalid';
      }
      // Hai yêu cầu mã đúng cùng challenge chỉ một lần có thể đến đây:
      // request sau đọc lại dưới khoá, thấy challenge đã bị tiêu thụ.
      await trx.deleteFrom('verification').where('id', '=', pending.id).execute();
      await trx.deleteFrom('verification').where('id', '=', attemptsRow!.id).execute();
      return 'valid';
    });
  }

  /**
   * Khóa ngân sách được tạo theo thứ tự user rồi IP để tránh deadlock.
   * @param userId ID đã xác thực primary factor.
   * @param ip IP đã chuẩn hoá, có thể vắng khi môi trường không cung cấp.
   * @returns Khóa cùng giới hạn của cửa sổ 20 phút.
   */
  private budgetKeys(userId: string, ip?: string): Array<{ identifier: string; limit: number }> {
    return [
      { identifier: 'mfa-fail-user-' + userId, limit: MAX_USER_MFA_FAILURES },
      ...(ip ? [{ identifier: 'mfa-fail-ip-' + createHash('sha256').update(ip).digest('hex'), limit: MAX_IP_MFA_FAILURES }] : []),
    ];
  }

  /**
   * Tăng số lượt SAI trong giao dịch đang giữ cả khoá user/IP.
   * Không dùng UPSERT(identifier) vì verification không có UNIQUE key.
   * @param trx Transaction chứa cả admission, xác minh và cập nhật.
   * @param budgets Các ngân sách đang được giữ khoá.
   */
  private async recordMfaFailure(trx: CentreTx, budgets: Array<{ identifier: string; limit: number }>): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MFA_WINDOW_MS);
    for (const { identifier } of budgets) {
      const row = await trx.selectFrom('verification')
        .select(['id', 'value', 'expires_at'])
        .where('identifier', '=', identifier)
        .executeTakeFirst();
      if (!row) {
        await trx.insertInto('verification')
          .values({ identifier, value: '1', expires_at: expiresAt })
          .execute();
        continue;
      }
      const expired = row.expires_at <= now;
      await trx.updateTable('verification')
        .set({
          value: String(expired ? 1 : Number(row.value) + 1),
          expires_at: expired ? expiresAt : row.expires_at,
        })
        .where('id', '=', row.id)
        .execute();
    }
  }

  /**
   * Cấp phiên sau khi qua bước hai: phiên lập trình qua cầu nối
   * (cùng cơ chế login-as), thân đáp ứng theo hình plugin trả
   * (`{ token, user }` ở dạng đã lược bỏ trường nhạy cảm).
   */
  private async issueSession(challenge: ResolvedChallenge): Promise<TwoFactorCompletionResult> {
    const ctx = await this.betterAuth.requireAuth().$context;
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'username', 'first_name', 'last_name', 'email_verified', 'created_at', 'updated_at'])
      .where('id', '=', challenge.userId)
      .limit(1)
      .executeTakeFirst();
    if (!user) {
      throw new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
    }
    const session = await this.bridge.createProgrammaticSession(user.id);
    return {
      sessionCookieName: ctx.authCookies.sessionToken.name,
      sessionCookieValue: session.signedCookieValue,
      sessionCookieAttributes: ctx.authCookies.sessionToken.attributes as Record<string, unknown>,
      sessionExpiresAt: session.expiresAt,
      twoFactorCookieName: challenge.twoFactorCookieName,
      twoFactorCookieAttributes: challenge.twoFactorCookieAttributes,
      body: {
        token: session.token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: `${user.first_name} ${user.last_name}`.trim(),
          emailVerified: user.email_verified,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      },
    };
  }
}

/** Đọc một cookie theo tên từ header Cookie thô (giá trị đã decode URI). */
function cookieValueOf(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
