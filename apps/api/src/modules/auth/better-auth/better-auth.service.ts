import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';
import { SessionService } from '../session.service';
import { PasswordService } from '../../users/password.service';
import { AuthMailService } from '../../mail/auth-mail.service';
import { LoginLockoutService } from '../login-lockout.service';
import { TotpService } from '../totp.service';
import {
  BETTER_AUTH_SESSION_COOKIE,
  createBetterAuth,
  type BetterAuthInstance,
  type BetterAuthMcpAsConfig,
  type BetterAuthSocialConfig,
} from './better-auth.instance';

export type AuthCutoverStage = 'off' | 'bake';

/**
 * Chủ sở hữu duy nhất của Better Auth instance trong tiến trình API.
 *
 * Instance tồn tại khi MỘT trong hai cờ bật:
 * - `BETTER_AUTH_ENABLED` (Giai đoạn 1 của issue #7): phiên BA song
 *   song với hệ auth tự viết — `enabled` giữ nguyên nghĩa này, guard nhận diện cookie và bridge chỉ chạy theo nó.
 * - `MCP_AS_ENABLED` (lát MCP-1, issue #163): instance kiêm máy chủ
 *   OAuth cho MCP — factory compose thêm jwt()/mcp()/cimd() (xem better-auth.instance.ts). Cờ này KHÔNG chờ cutover GĐ2: AS chỉ cần phiên BA + bảng users chung mà GĐ1 đã có.
 *
 * Cả hai cờ đều tắt thì service không dựng instance, handler không được mount (main.ts dựa vào `auth !== null`), hành vi của hệ auth hiện tại không đổi. Cờ bật mà thiếu `BETTER_AUTH_SECRET` thì constructor ném lỗi: app từ chối boot thay vì âm thầm chạy một hệ auth thiếu secret.
 *
 * Cờ thứ ba — `AUTH_CUTOVER_STAGE` (chặng 2.7): KHÔNG dựng instance, nó chỉ chọn LUỒNG CHÍNH từng phần trong cửa sổ bake ('bake' đòi hỏi `BETTER_AUTH_ENABLED`, xem constructor) và bật hook đồng bộ ngược mật khẩu. Mặc định 'off' — hành vi hiện tại.
 */
@Injectable()
export class BetterAuthService {
  private readonly logger = new Logger(BetterAuthService.name);

  readonly enabled: boolean;
  /** Cờ riêng của lát MCP-1: instance có compose máy chủ OAuth hay không. */
  readonly mcpAsEnabled: boolean;
  readonly auth: BetterAuthInstance | null;
  /** Cấu hình AS đã dùng dựng instance (null khi không bật) — RS ở tầng MCP lấy issuer/resource qua đây. */
  readonly mcpAs: BetterAuthMcpAsConfig | null;
  /** Provider xã hội đã đăng ký vào instance (chặng 2.3) — rỗng khi chưa cấu hình env nào. */
  readonly socialProvidersEnabled: readonly ('google' | 'facebook')[];
  /**
   * Chặng cutover của GĐ2 (env `AUTH_CUTOVER_STAGE`): 'off' = luồng cũ là chính như hiện tại; 'bake' = cửa sổ bake của bước A chặng 2.7 (login-as phát phiên BA; đổi mật khẩu qua BA đồng bộ ngược hash về users.password_hash — xem createBetterAuth bên dưới).
   */
  readonly cutoverStage: AuthCutoverStage;
  /**
   * Tên cookie phiên như chính Better Auth đặt (thêm tiền tố `__Secure-` khi baseURL là https) — các điểm tự đặt cookie phiên BA ngoài handler của nó (login-as, chặng 2.6) phải dùng đúng tên này, và guard nhận cả hai dạng.
   */
  readonly sessionCookieName: string;
  /** Cookie phiên có thuộc tính Secure hay không (khớp quy tắc của Better Auth theo baseURL). */
  readonly sessionCookieSecure: boolean;

  constructor(
    config: ConfigService,
    // Handle Kysely định tuyến theo trung tâm (issue #654, D2): instance Better Auth và closure đồng bộ ngược đều chạy trên facade `routedKysely` — facade tự phân giải kho đích theo ngữ cảnh ALS của request (kho chung mặc định, kho riêng khi Host đã chuẩn bị), giữ đúng ngữ nghĩa của handle bộ máy cũ định tuyến trước đây.
    spaceDb: SpaceDatabaseService,
    passwordService: PasswordService,
    // Cổng mail auth (chặng 2.5): Nest chích từ MailModule. Phải là
    // @Optional tường minh và KHÔNG khai union `| null` ở chữ ký —
    // union làm metadata phản chiếu thành Object khiến Nest không phân giải được tham số. Các nơi dựng service tay (unit spec, script) không truyền thì instance chạy không có đường mail — đúng nghĩa "chưa nối mail" của factory, không phải lỗi.
    @Optional() authMail?: AuthMailService,
    // Cổng lockout theo tài khoản (điểm 2.4): cùng khuôn @Optional như authMail — nơi dựng tay không truyền thì instance chạy không gắn hooks lockout (đúng nghĩa "thiếu = không gắn" của factory); app thật luôn có LoginLockoutService từ AuthModule. forwardRef: một cạnh của vòng provider với cầu nối/UsersService
    // (xem ghi chú tại CredentialBridgeService).
    @Optional()
    @Inject(forwardRef(() => LoginLockoutService))
    lockout?: LoginLockoutService,
    // Cổng MFA thống nhất: `TotpService` của module auth là nơi duy nhất đọc được trạng thái + secret của `user_totp` (nguồn trạng thái MFA duy nhất). Cùng khuôn @Optional như lockout — nơi dựng service tay (unit spec) không truyền thì instance chạy không có cổng MFA; app thật luôn có qua AuthModule (module đó xuất TotpService cho module này, vòng module đã có forwardRef ở cả hai phía).
    @Optional()
    @Inject(forwardRef(() => TotpService))
    totp?: TotpService,
    // AuthModule xuất cả hai cổng thu hồi phiên legacy. DI tuỳ chọn giữ tương thích với các unit factory kiểm tra cấu hình BA bằng service dựng tay.
    @Optional()
    @Inject(forwardRef(() => AuthRepository))
    authRepository?: AuthRepository,
    @Optional()
    @Inject(forwardRef(() => SessionService))
    sessionService?: SessionService,
  ) {
    this.enabled = config.get<boolean>('BETTER_AUTH_ENABLED') ?? false;
    this.mcpAsEnabled = config.get<boolean>('MCP_AS_ENABLED') ?? false;
    const socialProviders = readSocialConfig(config);
    this.socialProvidersEnabled = [
      ...(socialProviders.google ? (['google'] as const) : []),
      ...(socialProviders.facebook ? (['facebook'] as const) : []),
    ];
    this.cutoverStage = config.get<AuthCutoverStage>('AUTH_CUTOVER_STAGE') ?? 'off';
    // Cửa sổ bake phát phiên Better Auth làm luồng chính từng phần — nó vô nghĩa khi chính Better Auth không bật: fail-fast như thiếu secret, thay vì chạy một cấu hình nửa vời.
    if (this.cutoverStage === 'bake' && !this.enabled) {
      throw new Error(
        'AUTH_CUTOVER_STAGE=bake requires BETTER_AUTH_ENABLED=true (the bake window runs on Better Auth sessions)',
      );
    }
    if (!this.enabled && !this.mcpAsEnabled) {
      this.auth = null;
      this.mcpAs = null;
      this.sessionCookieName = BETTER_AUTH_SESSION_COOKIE;
      this.sessionCookieSecure = false;
      return;
    }
    const secret = readAuthSecret(config);
    const baseURL =
      config.get<string>('BETTER_AUTH_URL') ?? `http://localhost:${config.get<number>('PORT') ?? 3000}`;
    const cookieNaming = resolveSessionCookieNaming(baseURL);
    this.sessionCookieSecure = cookieNaming.secure;
    this.sessionCookieName = cookieNaming.name;
    this.mcpAs = buildMcpAsConfig(config, baseURL, this.mcpAsEnabled);

    this.auth = createBetterAuth({
      // Facade `routedKysely` đã mang đúng kiểu `CentreDb` của factory —
      // không còn ép kiểu ở biên DI như thời handle bộ máy cũ.
      db: spaceDb.routedKysely,
      secret,
      baseURL,
      trustedOrigins: readTrustedOrigins(config, baseURL),
      passwordService,
      authMail: authMail ?? null,
      mcpAs: this.mcpAs,
      socialProviders,
      // Lockout theo tài khoản (điểm 2.4): instance gắn hooks khi
      // có cổng — chính sách khoá là của tài khoản, không phải của cờ.
      lockout: lockout ?? null,
      // Cổng MFA thống nhất (xem mfa-gate.ts): trạng thái đọc từ
      // `user_totp` qua TotpService — nguồn trạng thái MFA duy
      // nhất. Chưa có TotpService (nơi dựng tay) thì cổng không
      // gắn — app thật luôn có.
      mfa: totp ? { isMfaEnabled: (userId: string) => totp.isEnabled(userId) } : null,
      // Reset/đổi mật khẩu phía BA phải vô hiệu hoá cả JWT refresh family và Redis.
      sessionRevocation: this.buildSessionRevocation(authRepository, sessionService),
      // Cửa sổ bake (chặng 2.7 bước A): mọi lần Better Auth ghi mật
      // khẩu credential mới (đổi mật khẩu, đặt lại qua reset, tạo
      // credential) đều đồng bộ ngược hash hiện hành về
      // `users.password_hash` — điều kiện để tắt AUTH_CUTOVER_STAGE
      // về 'off' là quay lại luồng cũ trọn vẹn (rollback trước bước
      // B). Ngoài cửa sổ bake: không hook, hành vi như hiện tại.
      legacyPasswordSync: this.buildLegacyPasswordSync(spaceDb),
    });
  }

  /**
   * Dựng cổng thu hồi phiên legacy cho factory: reset/đổi mật khẩu phía Better Auth phải vô hiệu hoá cả JWT refresh family và Redis trong cùng kho trung tâm. Thiếu một trong hai cổng thì không gắn — instance chạy không có thu hồi legacy.
   */
  private buildSessionRevocation(
    authRepository?: AuthRepository,
    sessionService?: SessionService,
  ): { revokeLegacySessions: (userId: string) => Promise<void> } | null {
    if (!authRepository || !sessionService) return null;
    return {
      revokeLegacySessions: async (userId: string): Promise<void> => {
        await Promise.all([
          authRepository.revokeAllForUser(userId),
          sessionService.destroyAllForUser(userId),
        ]);
      },
    };
  }

  /**
   * Dựng hook đồng bộ ngược hash trong cửa sổ bake (chặng 2.7 bước A): mọi lần Better Auth ghi mật khẩu credential mới đều chép hash hiện hành về `users.password_hash` — điều kiện để tắt `AUTH_CUTOVER_STAGE` về 'off' là quay lại luồng cũ trọn vẹn (rollback trước bước B). Ngoài cửa sổ bake: không hook, hành vi như hiện tại.
   */
  private buildLegacyPasswordSync(
    spaceDb: SpaceDatabaseService,
  ): { syncFromCredentialAccount: (userId: string) => Promise<void> } | null {
    if (this.cutoverStage !== 'bake') return null;
    return {
      syncFromCredentialAccount: async (userId: string): Promise<void> => {
        // Hash nguồn là hash ĐANG NẰM ở dòng credential —
        // đọc tại thời điểm gọi (sau khi phía Better Auth đã
        // ghi xong) nên không cần biết đường nào vừa ghi.
        // Lỗi đồng bộ không được làm hỏng thao tác auth vừa
        // thành công (mật khẩu mới đã là sự thật ở phía BA)
        // — nhưng phải kêu to trong log thay vì âm thầm để
        // hai hệ lệch mật khẩu trong cửa sổ bake.
        try {
          const row = await spaceDb.routedKysely
            .selectFrom('account')
            .select('password')
            .where('user_id', '=', userId)
            .where('provider_id', '=', 'credential')
            .limit(1)
            .executeTakeFirst();
          if (!row?.password) return;
          await spaceDb.routedKysely
            .updateTable('users')
            .set({ password_hash: row.password })
            .where('id', '=', userId)
            .execute();
        } catch (err) {
          this.logger.warn(`legacy password sync failed for user ${userId}: ${String(err)}`);
        }
      },
    };
  }

  /** Instance khi có cờ bật; ném lỗi rõ ràng nếu gọi lúc cả hai cờ tắt (lỗi lập trình, không phải lỗi người dùng). */
  requireAuth(): BetterAuthInstance {
    if (!this.auth) {
      throw new Error(
        'Better Auth is not enabled (BETTER_AUTH_ENABLED and MCP_AS_ENABLED are both off)',
      );
    }
    return this.auth;
  }
}

/**
 * Secret của Better Auth: bắt buộc khi instance được dựng (một trong hai cờ bật) — thiếu thì từ chối boot thay vì âm thầm chạy một hệ auth thiếu secret.
 */
function readAuthSecret(config: ConfigService): string {
  const secret = config.get<string>('BETTER_AUTH_SECRET');
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is required when BETTER_AUTH_ENABLED or MCP_AS_ENABLED is true',
    );
  }
  return secret;
}

/**
 * Tên + cờ Secure của cookie phiên theo đúng quy tắc của Better Auth: baseURL https ⇒ cookie Secure + tiền tố `__Secure-` trong tên.
 */
function resolveSessionCookieNaming(baseURL: string): { secure: boolean; name: string } {
  const secure = baseURL.startsWith('https://');
  return {
    secure,
    name: secure ? `__Secure-${BETTER_AUTH_SESSION_COOKIE}` : BETTER_AUTH_SESSION_COOKIE,
  };
}

/** Origins tin cậy của instance: baseURL luôn có mặt, cộng thêm các origin khai trong env (đã cắt khoảng trắng, bỏ rỗng, khử trùng). */
function readTrustedOrigins(config: ConfigService, baseURL: string): string[] {
  const extraOrigins = (config.get<string>('BETTER_AUTH_TRUSTED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([baseURL, ...extraOrigins])];
}

/**
 * Cấu hình máy chủ OAuth cho MCP (lát MCP-1, issue #163): `null` khi cờ MCP_AS_ENABLED tắt.
 *
 * Resource phải là URI công khai mà client nhìn thấy (nó trở thành `aud` của access token và đích của PRM): ưu tiên MCP_PUBLIC_BASE_URL — cùng một origin mà mount MCP quảng bá — rồi rơi về origin của BA, cuối cùng là baseURL.
 */
function buildMcpAsConfig(
  config: ConfigService,
  baseURL: string,
  mcpAsEnabled: boolean,
): BetterAuthMcpAsConfig | null {
  if (!mcpAsEnabled) return null;
  const mcpPublicBase = (
    config.get<string>('MCP_PUBLIC_BASE_URL') ??
    config.get<string>('BETTER_AUTH_URL') ??
    baseURL
  ).replace(/\/+$/, '');
  return {
    resource: `${mcpPublicBase}/mcp`,
    loginPage: '/mcp-login',
    consentPage: '/mcp-consent',
  };
}

/**
 * Đọc một cặp id/secret của provider xã hội từ env: chỉ trả cặp khi CẢ hai đều có mặt — thiếu một phía thì provider đó tắt êm (không đăng ký, không lỗi boot), đúng luật "issuer chưa cấu hình thì không có bề mặt" của hệ.
 */
function readSocialProvider(
  config: ConfigService,
  idKey: string,
  secretKey: string,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = config.get<string>(idKey);
  const clientSecret = config.get<string>(secretKey);
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * Đọc cấu hình đăng nhập xã hội từ env (issue #7, chặng 2.3): provider
 * chỉ vào cấu hình khi CẢ id lẫn secret đều có mặt — thiếu một phía
 * thì provider đó tắt êm (không đăng ký, không lỗi boot), đúng luật
 * "issuer chưa cấu hình thì không có bề mặt" của hệ.
 */
function readSocialConfig(config: ConfigService): BetterAuthSocialConfig {
  const google = readSocialProvider(config, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  const facebook = readSocialProvider(config, 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET');
  return {
    ...(google ? { google } : {}),
    ...(facebook ? { facebook } : {}),
  };
}
