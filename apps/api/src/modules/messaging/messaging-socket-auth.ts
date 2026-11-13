import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { fromNodeHeaders } from 'better-auth/node';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { BetterAuthService } from '../auth/better-auth/better-auth.service';
import { BETTER_AUTH_SESSION_COOKIE } from '../auth/better-auth/better-auth.instance';
import { tenantAls } from '../tenants/tenant-als';
import { extractSpaceSlugFromHost, resolveDedicatedSpace, type DedicatedSpace } from '../tenants/space-resolution';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';

export interface MessagingSocketIdentity {
  userId: string;
  username: string;
  /**
   * Tenant hiệu lực của phiên (claim `tid` của token, TENANT-1 #196):
   * room + khoá presence của socket được namespace theo tenant này. Token cũ không mang `tid` → null (room rơi về đoạn 'platform'). Phiên cookie Better Auth không mang claim: tenant được phân giải là tenant mặc định của user (xem authenticateCookie).
   */
  tenantId: string | null;
  /**
   * Slug của trung tâm ở kho riêng mà danh tính này đã được phân giải TRONG kho của trung tâm đó; `null` khi danh tính thuộc đường kho chung (địa chỉ thường, trung tâm kho chung, hoặc phiên vận hành platform được tra ở kho chung ngay tại địa chỉ kho riêng). Gateway gắn slug này lên kết nối để mọi lượt đọc dữ kiện theo kết nối (vào room lúc nối, join/sync/typing) chạy trong đúng kho của trung tâm qua `withSpaceKysely` — danh tính đã phân giải ở kho riêng mà các lượt đọc đó rơi về kho chung thì hội thoại/membership của trung tâm vô hình với socket dù xác thực đã qua.
   */
  spaceSlug: string | null;
  /** Định danh đăng ký của kho đã xác thực; khác nhau dù ID nội bộ của hai kho trùng nhau. */
  spaceId?: string | null;
}

/** Phần handshake của Socket.IO mà lớp auth cần: `auth` mang theo + headers (chứa cookie). */
export interface MessagingHandshake {
  auth?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

const SESSION_COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)(?:__Secure-)?${BETTER_AUTH_SESSION_COOKIE}=`);

/**
 * Lớp xác thực MỎNG cho kênh realtime của messaging — điểm chạm DUY
 * NHẤT của gateway với cơ chế auth (issue #33, chặng A1).
 *
 * Hai đường danh tính, đúng thứ tự của chuỗi guard HTTP (GĐ5 của
 * issue #7 — realtime trên cookie):
 *
 * 1. **Cookie phiên Better Auth TRƯỚC** — cùng semantics với
 *    `BetterAuthSessionGuard` phía HTTP: cờ Better Auth bật + cookie
 *    phiên có mặt + phiên hợp lệ + tài khoản còn active (không
 *    suspended/deleted) thì danh tính chốt ở đây. Cookie có nhưng
 *    phiên không dùng được (hỏng chữ ký, hết hạn, tài khoản bị khoá)
 *    thì KHÔNG kết luận từ chối — rơi xuống đường token, đúng như
 *    guard HTTP không đặt danh tính và để JwtAuthGuard quyết định.
 * 2. **Access token JWT hiện tại** làm đường dự phòng (giữ nguyên
 *    hành vi cho tới cutover GĐ2): token mang `{ sub, username, sid }`,
 *    không có `scope` (token có scope là của luồng khác, bị
 *    JwtAuthStrategy của REST từ chối), và user phải còn active. Lớp
 *    này áp đúng các kiểm đó qua cùng secret và UsersService.
 *
 * Phân giải không gian theo địa chỉ (tiền điều kiện Phần B của
 * issue #587, hạng mục 1): handshake mang header `Host` như request
 * HTTP, nên lớp này phân giải không gian từ Host MỘT lần cho cả hai
 * đường, đúng khuôn `BetterAuthSessionGuard`/`JwtAuthStrategy` phía
 * HTTP: địa chỉ thuộc trung tâm ở kho riêng thì mọi lượt đọc danh
 * tính của handshake đó — phiên, tài khoản và tenant mặc định của
 * đường cookie; lượt tra tài khoản của đường token — đều chạy
 * trong CHÍNH kho của trung tâm qua `withSpaceKysely`. Sau khi
 * một trung tâm lật định tuyến, phiên/tài khoản của thành viên chỉ
 * còn tồn tại ở kho riêng: đọc ở kho chung sẽ không thấy gì và
 * realtime chết lặng trong khi REST vẫn chạy trên kho riêng. Lỗi
 * phân giải/chuẩn bị kho đích ném ra nguyên trạng để gateway ngắt
 * kết nối kèm log — fail-closed, tuyệt đối không rơi lặng về đường
 * kho chung; đây là điểm khác guard HTTP, vì guard còn lớp JWT phía
 * sau quyết định lại còn kênh socket thì không có lớp thứ hai.
 *
 * Host mang slug nhưng sổ đăng ký không cấu hình hoặc không có slug
 * đó phải bị chặn trước cả xác thực cookie/token. Chỉ Host gốc
 * (không có slug) hoặc slug được xác nhận là kho shared mới được
 * đi theo đường kho chung; tuyệt đối không fallback khi mất sổ.
 *
 * Gateway, consumer và tầng phân phối không biết gì về cơ chế bên
 * dưới — chúng chỉ nhận `MessagingSocketIdentity | null`.
 */
@Injectable()
export class MessagingSocketAuth {
  private readonly jwt: JwtService;
  /** Host gốc đáng tin cậy lấy từ origin API cấu hình, KHÔNG từ request. */
  private readonly publicRootHostname: string | null;
  private readonly allowLocalRoot: boolean;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly users: UsersService,
    private readonly betterAuth: BetterAuthService,
    private readonly repo: MessagingRepository,
    private readonly spaceDb: SpaceDatabaseService,
    private readonly tenants: TenantsService,
  ) {
    this.jwt = new JwtService({ secret: config.getOrThrow<string>('JWT_SECRET') });
    this.publicRootHostname = configuredApiHostname(config.get<string>('BETTER_AUTH_URL'));
    const environment = config.get<string>('NODE_ENV');
    // Chỉ test/dev mới nhận hostname loopback khi API không có public
    // URL. Production thiếu BETTER_AUTH_URL thì ngoại lệ fail-closed.
    this.allowLocalRoot = environment === 'test' || environment === 'development';
  }

  /**
   * Xác thực toàn bộ handshake: phân giải không gian từ `Host`
   * trước, rồi thử cookie phiên Better Auth, không chốt được danh
   * tính thì thử token mang theo handshake. Null nghĩa là cả hai
   * đường đều không dùng được — gateway ngắt kết nối ngay, không
   * lộ lý do ra client.
   *
   * Bước chuẩn bị kho đích (`getKyselyForSpace`) chạy tại đây,
   * trước cả hai đường, đúng bước PREPARE của khung định tuyến:
   * lỗi phân giải/chuẩn bị ném ra ngoài (gateway ngắt kết nối kèm
   * log) thay vì được nuốt thành null — một handshake thuộc trung
   * tâm kho riêng không bao giờ được phục vụ lặng lẽ từ kho chung.
   *
   * Khi Host có slug mà chưa thể phân giải hợp lệ, helper ném lỗi
   * ngay trước khi đọc cookie hay token; không có lượt tra kho chung.
   */
  async authenticateHandshake(handshake: MessagingHandshake): Promise<MessagingSocketIdentity | null> {
    const hostHeader = handshake.headers['host'];
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    const space = await resolveDedicatedSpace(this.spaceDb, hostHeader);
    if (space) await this.spaceDb.getKyselyForSpace(space.slug);
    const viaCookie = await this.authenticateCookie(handshake.headers, space);
    if (viaCookie) return viaCookie;
    // Host không có slug KHÔNG đủ chứng minh đây là hostname gốc.
    // Chỉ so khớp chính xác với hostname API cấu hình từ env (hoặc
    // loopback test/dev); tuyệt đối không tin Host bất kỳ hai nhãn.
    const isRootHost = this.isTrustedRootHost(host);
    return this.authenticate(extractHandshakeToken(handshake), space, isRootHost);
  }

  /**
   * Chỉ công nhận ngoại lệ Trang chính cho đúng hostname gốc được
   * lấy từ cấu hình API, không từ dữ liệu do client tự cung cấp.
   */
  private isTrustedRootHost(host: string | undefined): boolean {
    if (extractSpaceSlugFromHost(host)) return false;
    const hostname = hostnameFromHostHeader(host);
    if (!hostname) return false;
    if (this.publicRootHostname && hostname === this.publicRootHostname) return true;
    return this.allowLocalRoot && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  }

  /**
   * Danh tính từ cookie phiên Better Auth trong headers của
   * handshake (trình duyệt gửi cookie cùng nguồn kèm request bắt tay
   * khi client bật `withCredentials`). Trả null cho mọi trường hợp
   * không dùng được: cờ tắt, không có cookie phiên, phiên
   * hỏng/hết hạn, user không còn active.
   *
   * Phiên cookie không mang claim tenant như JWT: tenant hiệu lực
   * được phân giải như `TenantGuard` phía HTTP khi danh tính không
   * có `tid` — tenant mặc định của user theo membership (cùng luật
   * `TenantsService.resolveDefaultTenant`, bản gương trong repo của
   * messaging), tra cứu trong ngữ cảnh platform vì đây là đường
   * tiền-ngữ-cảnh giống hệt cách TenantGuard tự phân giải.
   *
   * Khi địa chỉ thuộc trung tâm ở kho riêng (`space` khác null),
   * cả ba lượt đọc — phiên, tài khoản, tenant mặc định — chạy
   * trong kho của trung tâm đó qua `withSpaceKysely`: phiên
   * Better Auth của thành viên chỉ tồn tại ở kho riêng nên đọc ở
   * kho chung trả rỗng, và phiên chỉ tồn tại ở kho chung mang tới
   * địa chỉ này cũng không được phục vụ lặng lẽ từ kho chung.
   * Lượt suy tenant mặc định vẫn chạy trong ngữ cảnh platform
   * nhưng store ALS PHẢI giữ `spaceSlug` và `spaceId` của trung tâm: thay toàn
   * bộ store bằng `{ platform: true }` trần sẽ đánh rơi slug và
   * handle định tuyến rơi về kho chung (đúng lớp lỗi A4 của Phần A
   * đã sửa ở các wrapper phía service).
   */
  async authenticateCookie(
    headers: Record<string, string | string[] | undefined>,
    space?: DedicatedSpace | null,
  ): Promise<MessagingSocketIdentity | null> {
    if (!this.betterAuth.enabled) return null;
    const cookie = headers['cookie'];
    if (typeof cookie !== 'string' || !SESSION_COOKIE_PATTERN.test(cookie)) return null;
    const auth = this.betterAuth.requireAuth();
    const readSession = () => auth.api.getSession({ headers: fromNodeHeaders(headers) });
    let resolved: Awaited<ReturnType<typeof readSession>> = null;
    try {
      resolved = space ? await this.spaceDb.withSpaceKysely(space.slug, readSession) : await readSession();
    } catch {
      // Cookie hỏng chữ ký/định dạng: coi như không có phiên Better
      // Auth, để đường token quyết định — như BetterAuthSessionGuard.
      return null;
    }
    if (!resolved) return null;
    const readUser = () => this.users.getByIdOrUndefined(resolved.session.userId);
    let user: Awaited<ReturnType<typeof readUser>>;
    try {
      user = space ? await this.spaceDb.withSpaceKysely(space.slug, readUser) : await readUser();
    } catch {
      // Tài khoản không đọc được trong kho của phiên: không đặt
      // danh tính từ cookie, để đường token quyết định — như
      // BetterAuthSessionGuard phía HTTP.
      return null;
    }
    if (!user || user.suspended || user.deleted) return null;
    const tenantId = space
      ? await this.spaceDb.withSpaceKysely(space.slug, () =>
          tenantAls.run({ platform: true, spaceSlug: space.slug, spaceId: space.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle }, () =>
            this.repo.getUserDefaultTenantId(user.id),
          ),
        )
      : await tenantAls.run({ platform: true }, () => this.repo.getUserDefaultTenantId(user.id));
    return { userId: user.id, username: user.username, tenantId, spaceSlug: space?.slug ?? null, spaceId: space?.spaceId ?? null };
  }

  /**
   * Xác thực một access token lấy từ handshake của socket. Trả null
   * cho mọi trường hợp không hợp lệ (thiếu token, sai chữ ký, hết hạn,
   * token có scope, thiếu sid, user không còn active) — gateway ngắt
   * kết nối ngay, không lộ lý do ra client.
   *
   * Khi địa chỉ thuộc trung tâm ở kho riêng (`space` khác null),
   * đường token áp đúng nguyên tắc cổng 1a/1b của Phần A như
   * `JwtAuthStrategy` + `SpaceContextGuard` phía HTTP:
   * - Token mang claim `centre_id` lệch định danh của trung tâm
   *   tại địa chỉ → từ chối TRƯỚC khi chạm vào kho đích (không tra
   *   kho nào để khẳng định thêm); claim khớp thì tài khoản tra
   *   trong CHÍNH kho của trung tâm đó.
   * - Token KHÔNG mang claim `centre_id` là phiên cấp trước khi
   *   trung tâm tách kho → từ chối fail-closed, chủ phiên phải
   *   đăng nhập lại tại địa chỉ của trung tâm để nhận phiên mang
   *   claim. Ngoại lệ duy nhất giữ nguyên khuôn chiến lược JWT:
   *   phiên vận hành platform (mang `tid` của tenant platform,
   *   không mang claim) tra ở kho chung như cũ — quản trị viên
   *   platform không có tài khoản trong kho riêng, và danh tính
   *   của đường này thuộc kho chung nên `spaceSlug` trả về null.
   *
   * Khi không có không gian dedicated (Host gốc hoặc Host shared),
   * token mang centre_id chỉ được chấp nhận cho Trang chính tại
   * hostname gốc, khi cả tid lẫn spaceId khớp dòng platform đã
   * đăng ký. Các token trung tâm khác phải bị chặn TRƯỚC khi đọc
   * user tại database shared, kể cả user còn bản sao legacy.
   *
   * Lỗi định tuyến Host (bao gồm mất cấu hình hoặc slug chưa đăng
   * ký) được xử lý fail-closed ở `authenticateHandshake`, trước
   * khi gọi tới phương thức xác thực token này.
   */
  async authenticate(
    token: string | undefined,
    space?: DedicatedSpace | null,
    isRootHost = false,
  ): Promise<MessagingSocketIdentity | null> {
    if (!token) return null;
    let payload: { sub?: string; username?: string; scope?: unknown; sid?: unknown; tid?: unknown; centre_id?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    // Cùng luật với JwtAuthStrategy phía REST: chỉ access token đăng
    // nhập (không scope) gắn với một phiên (sid) mới được chấp nhận.
    if (!payload.sub || payload.scope !== undefined || typeof payload.sid !== 'string') return null;
    const sub = payload.sub;
    const tid = typeof payload.tid === 'string' ? payload.tid : undefined;
    let user: Awaited<ReturnType<typeof this.users.getByIdOrUndefined>>;
    let resolvedInSpace = false;
    if (space) {
      if (payload.centre_id !== undefined) {
        if (payload.centre_id !== space.spaceId) return null;
        user = await this.spaceDb.withSpaceKysely(space.slug, () => this.users.getByIdOrUndefined(sub));
        resolvedInSpace = true;
      } else if (tid !== undefined && tid === (await this.tenants.platformTenant()).id) {
        user = await this.users.getByIdOrUndefined(sub);
      } else {
        return null;
      }
    } else {
      if (payload.centre_id !== undefined) {
        // JWT của trung tâm A/B KHÔNG thể xác thực ở Host gốc hoặc
        // Host shared chỉ vì user còn trong kho chung sau di trú.
        // Ngoại lệ Trang chính phải được xác minh bằng cả tenant
        // hiệu lực và ID không gian trong sổ, giống REST.
        if (!isRootHost || tid === undefined) return null;
        const platform = await this.tenants.platformTenant();
        if (tid !== platform.id) return null;
        try {
          const registered = await this.spaceDb.resolveTarget(platform.slug);
          if (registered.spaceId !== payload.centre_id) return null;
        } catch {
          // Không có sổ đăng ký thì không được suy đoán phiên platform.
          return null;
        }
      }
      user = await this.users.getByIdOrUndefined(sub);
    }
    if (!user || user.suspended || user.deleted) return null;
    return {
      userId: user.id,
      username: user.username,
      tenantId: tid ?? null,
      spaceSlug: resolvedInSpace ? space!.slug : null,
      spaceId: resolvedInSpace ? space!.spaceId : null,
    };
  }
}

/**
 * Host của origin API do deployment cấu hình (không nhận từ header).
 * URL thiếu/sai định dạng không cấp ngoại lệ cho phiên Trang chính.
 */
function configuredApiHostname(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Phân tích Host request mà không cho phép URL chứa userinfo/path/query
 * đánh lừa bộ so khớp. Chỉ tên host (không phải cổng) phải khớp origin
 * đáng tin cậy vì reverse proxy có thể chuyển tiếp cổng khác.
 */
function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host || host !== host.trim() || /[\\/\s@?#]/.test(host)) return null;
  try {
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Token từ handshake: ưu tiên `auth.token` (socket.io client chính thức), dự phòng header Bearer. */
function extractHandshakeToken(handshake: MessagingHandshake): string | undefined {
  const authToken = (handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof authToken === 'string' && authToken.length > 0) return authToken;
  const header = handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return undefined;
}
