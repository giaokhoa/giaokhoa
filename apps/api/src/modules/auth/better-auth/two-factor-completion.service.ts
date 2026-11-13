/**
 * Hoàn tất bước hai của đăng nhập Better Auth (endpoint
 * `/auth/two-factor/verify-totp` và `/auth/two-factor/verify-backup-code`
 * ở tầng Nest — mount chừa segment `two-factor` cho Nest, xem
 * `better-auth.mount.ts`).
 *
 * Vì sao bước hoàn tất nằm ở đây thay vì plugin twoFactor của Better
 * Auth: xem khối plugins trong `better-auth.instance.ts` (plugin đòi
 * trường user `twoFactorEnabled` không có trong ánh xạ của hệ và sẽ
 * dựng nguồn trạng thái MFA thứ hai). Ở đây trạng thái MFA và việc
 * kiểm mã đều đi qua MỘT nguồn duy nhất là `user_totp` qua
 * `TotpService` của module auth — cùng cơ chế verify mà các luồng
 * đăng nhập tự viết dùng.
 *
 * Giao thức với cổng MFA (`mfa-gate.ts`) — cổng phát, nơi này tiêu
 * thụ, đúng định dạng plugin twoFactor của better-auth@1.7.12 tự
 * dùng nên semantics hai phía khớp nhau:
 *
 * - Cookie ký `better-auth.two_factor` (tên lấy từ createAuthCookie
 *   của chính instance) chứa identifier của challenge; chữ ký HMAC
 *   kiểm bằng secret của instance (`makeSignature` +
 *   `constantTimeEqual` của `better-auth/crypto`).
 * - Dòng verification `2fa-<id>` → userId, hạn 600 giây; dòng
 *   `2fa-attempts-<id>` đếm số lần thử SAI của challenge đó, ngân
 *   sách 5 lần: mỗi lần verify đều TIÊU THỤ cả hai dòng trước;
 *   sai mã thì dựng lại dòng attempts với đếm +1 (cùng hạn của
 *   challenge), hết ngân sách thì challenge bị huỷ và bị từ chối
 *   bằng `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` — người dùng phải
 *   đăng nhập lại để có challenge mới.
 * - Mã đúng: challenge đã tiêu thụ (không chơi lại được), phiên
 *   được tạo qua cầu nối phiên lập trình (cùng cơ chế login-as tạo
 *   phiên Better Auth ngoài handler) và cookie phiên được đặt theo
 *   đúng thuộc tính cookie của instance; cookie chờ bước hai bị
 *   xoá. Người dùng bị đình chỉ vẫn nhận phiên ở bước này như
 *   semantics của Better Auth — guard phiên chặn mọi route nghiệp
 *   vụ của tài khoản đình chỉ ngay sau đó.
 * - Kiểm Origin như handler Better Auth làm với POST mang cookie:
 *   Origin có mặt mà không thuộc origins tin cậy của instance thì
 *   403 trước mọi xử lý.
 * - Mã dự phòng: sản phẩm không có khái niệm mã dự phòng (factor
 *   TOTP của hệ tự viết không phát mã dự phòng) nên endpoint
 *   verify-backup-code luôn từ chối bằng `INVALID_BACKUP_CODE` —
 *   nhưng vẫn qua cùng cửa challenge + đếm lần thử để không thành
 *   một lối dò riêng.
 * - Thiết bị tin cậy (trust device): cổng có tôn trọng cookie tin
 *   cậy nếu tồn tại, nhưng bước hoàn tất này KHÔNG phát cookie tin
 *   cậy mới — giao diện không có tuỳ chọn "tin cậy thiết bị này",
 *   phát dấu mà người dùng không hề chọn sẽ là nới lỏng âm thầm.
 */
import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { constantTimeEqual, makeSignature } from 'better-auth/crypto';
import { createHash } from 'node:crypto';
import { sql } from '@giaokhoa/db';
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
  attempts: number;
  twoFactorCookieName: string;
  twoFactorCookieAttributes: Record<string, unknown>;
}

@Injectable()
export class TwoFactorCompletionService {
  /**
   * Facade Kysely định tuyến theo trung tâm (issue #654, D2): giữ tham
   * chiếu tới facade là an toàn — facade tự phân giải kho đích theo
   * ngữ cảnh ALS tại mỗi lần gọi, không phải ảnh chụp kho tại thời
   * điểm dựng service. Bảng `verification` của codegen CentreDB thay
   * cho bảng bóng bộ máy cũ đã xoá (cùng cột: identifier, value,
   * expires_at; id do DB sinh — các lần chèn ở đây không khai id).
   */
  private readonly db: CentreDb;

  constructor(
    spaceDb: SpaceDatabaseService,
    private readonly betterAuth: BetterAuthService,
    private readonly bridge: CredentialBridgeService,
    // Cùng khuôn phụ thuộc với BetterAuthService: AuthModule xuất
    // TotpService qua vòng forwardRef; thiếu phụ thuộc (chỉ xảy ra
    // khi module bị dựng dở) thì mọi verify bị từ chối fail-closed
    // ở completeTotp thay vì cho qua.
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
    await this.assertMfaBudget(challenge.userId, clientIpOf(req));
    await this.beginAttempt(challenge);
    if (!this.totp) {
      throw new TwoFactorCompletionError(500, 'mfa_status_unavailable', 'Could not verify multi-factor authentication status');
    }
    let valid: boolean;
    try {
      valid = await this.totp.verifyForUser(challenge.userId, code);
    } catch {
      // Lỗi ở tầng kiểm mã (không phải mã sai): trả lại ngân sách
      // của lần thử này như semantics `restore()` của plugin, rồi
      // fail-closed — không kết luận được thì không cấp phiên.
      await this.rearmAttempts(challenge, challenge.attempts);
      throw new TwoFactorCompletionError(500, 'mfa_status_unavailable', 'Could not verify multi-factor authentication status');
    }
    if (!valid) {
      // Ghi lỗi MFA theo user/IP trước khi dựng lại challenge: đăng nhập mới không được xoá ngân sách.
      await this.recordMfaFailure(challenge.userId, clientIpOf(req));
      await this.rearmAttempts(challenge, challenge.attempts + 1);
      throw new TwoFactorCompletionError(401, 'INVALID_CODE', 'Invalid code');
    }
    return this.issueSession(challenge);
  }

  /**
   * Mã dự phòng: sản phẩm không phát mã dự phòng nên luôn từ chối;
   * vẫn đi qua cửa challenge + đếm lần thử như verify TOTP.
   */
  async verifyBackupCode(req: Request): Promise<never> {
    const challenge = await this.resolveChallenge(req);
    await this.assertMfaBudget(challenge.userId, clientIpOf(req));
    await this.beginAttempt(challenge);
    await this.recordMfaFailure(challenge.userId, clientIpOf(req));
    await this.rearmAttempts(challenge, challenge.attempts + 1);
    throw new TwoFactorCompletionError(400, 'INVALID_BACKUP_CODE', 'Invalid backup code');
  }

  /**
   * Giải challenge từ cookie chờ: kiểm Origin, chữ ký cookie, hạn
   * dùng và sự tồn tại của dòng verification. Mọi bất thường đều là
   * `INVALID_TWO_FACTOR_COOKIE` (401) như plugin — không phân biệt
   * "không có cookie" với "chữ ký sai" với "đã hết hạn" để không lộ
   * trạng thái challenge.
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
    // Kiểm Origin như handler Better Auth: Origin có mặt phải thuộc
    // origins tin cậy (gồm origin của baseURL) — chặn POST chéo
    // origin mang cookie chờ.
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
    const attemptsRow = await this.db
      .selectFrom('verification')
      .selectAll()
      .where('identifier', '=', `2fa-attempts-${identifier}`)
      .limit(1)
      .executeTakeFirst();
    const parsed = attemptsRow ? Number(attemptsRow.value) : Number.NaN;
    return {
      identifier,
      userId: pending.value,
      expiresAt: pending.expires_at,
      attempts: Number.isInteger(parsed) && parsed >= 0 ? parsed : MAX_CHALLENGE_ATTEMPTS,
      twoFactorCookieName: cookieAttrs.name,
      twoFactorCookieAttributes: cookieAttrs.attributes as Record<string, unknown>,
    };
  }

  /**
   * Tiêu thụ challenge qua giao dịch DELETE RETURNING: PostgreSQL chỉ cho một
   * request chiếm dòng khi nhiều verify song song; replay bị từ chối.
   * @param challenge Challenge đã giải từ cookie và kho verification.
   * @throws TwoFactorCompletionError Khi không chiếm được challenge.
   */
  private async beginAttempt(challenge: ResolvedChallenge): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const consumed = await trx.deleteFrom('verification')
        .where('identifier', '=', challenge.identifier)
        .where('expires_at', '>', new Date())
        .returning('value')
        .executeTakeFirst();
      if (!consumed || consumed.value !== challenge.userId) {
        throw new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
      }
      await trx.deleteFrom('verification')
        .where('identifier', '=', '2fa-attempts-' + challenge.identifier)
        .execute();
    });
    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      throw new TwoFactorCompletionError(
        400,
        'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
        'Too many attempts. Please request a new code.',
      );
    }
  }

  /**
   * Chặn ngân sách MFA tổng hợp theo user và IP, độc lập challenge riêng lẻ.
   * @param userId Danh tính đã qua primary authentication.
   * @param ip Địa chỉ do proxy tin cậy xác định.
   * @throws TwoFactorCompletionError Khi chạm một trong hai ngưỡng.
   */
  private async assertMfaBudget(userId: string, ip?: string): Promise<void> {
    const identifiers = [
      { identifier: 'mfa-fail-user-' + userId, limit: MAX_USER_MFA_FAILURES },
      ...(ip ? [{ identifier: 'mfa-fail-ip-' + createHash('sha256').update(ip).digest('hex'), limit: MAX_IP_MFA_FAILURES }] : []),
    ];
    for (const { identifier, limit } of identifiers) {
      const budget = await this.db.selectFrom('verification')
        .select(['value', 'expires_at'])
        .where('identifier', '=', identifier)
        .executeTakeFirst();
      if (budget && budget.expires_at > new Date() && Number(budget.value) >= limit) {
        throw new TwoFactorCompletionError(429, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'Too many attempts. Please try again later.');
      }
    }
  }

  /**
   * Ghi số lần xác minh MFA sai bằng UPSERT nguyên tử trong verification,
   * dùng chung giữa các API instance; hết cửa sổ cũ thì đặt lại đếm.
   * @param userId Danh tính đã qua bước đăng nhập thứ nhất.
   * @param ip Địa chỉ khách thật đã chuẩn hoá.
   */
  private async recordMfaFailure(userId: string, ip?: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MFA_WINDOW_MS);
    const identifiers = [
      'mfa-fail-user-' + userId,
      ...(ip ? ['mfa-fail-ip-' + createHash('sha256').update(ip).digest('hex')] : []),
    ];
    for (const identifier of identifiers) {
      // Bảng verification của Better Auth KHÔNG có UNIQUE(identifier).
      // Khoá advisory theo key trong transaction rồi cập nhật/chèn để
      // các API instance không mất lượt thử khi request chạy song song.
      await this.db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
        const existing = await trx.selectFrom('verification')
          .select(['id', 'value', 'expires_at'])
          .where('identifier', '=', identifier)
          .executeTakeFirst();
        if (!existing) {
          await trx.insertInto('verification')
            .values({ identifier, value: '1', expires_at: expiresAt }).execute();
          return;
        }
        const expired = existing.expires_at <= now;
        await trx.updateTable('verification')
          .set({
            value: String(expired ? 1 : Number(existing.value) + 1),
            expires_at: expired ? expiresAt : existing.expires_at,
          })
          .where('id', '=', existing.id).execute();
      });
    }
  }

  /** Dựng lại dòng đếm lần thử sau một lần verify không thành công (cùng hạn với challenge). */
  private async rearmAttempts(challenge: ResolvedChallenge, count: number): Promise<void> {
    await this.db
      .insertInto('verification')
      .values({
        identifier: `2fa-attempts-${challenge.identifier}`,
        value: String(count),
        expires_at: challenge.expiresAt,
      })
      .execute();
    // Dòng challenge phải sống lại cùng dòng đếm: beginAttempt đã
    // tiêu thụ cả hai, lần verify kế tiếp cần tìm thấy challenge.
    await this.db
      .insertInto('verification')
      .values({
        identifier: challenge.identifier,
        value: challenge.userId,
        expires_at: challenge.expiresAt,
      })
      .execute();
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
