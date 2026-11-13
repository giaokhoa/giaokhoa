import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './current-user.decorator';
import { IS_PLATFORM_ROUTE_KEY } from './platform-route.decorator';
import { IS_SUPPORT_ROUTE_KEY } from './support-route.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Guard tách audience token (issue #584, mở rộng giới hạn hỗ trợ #19):
 * token nghiệp vụ, platform admin và support là BA BỀ MẶT khác nhau.
 * Chỉ `aud=support` được gọi `@SupportRoute()`; token support không
 * vào `@PlatformRoute()` hoặc route nghiệp vụ, token platform không
 * tự truy cập support route kể cả khi là siteadmin.
 * Chạy ngay sau JwtAuthGuard, trước TenantGuard.
 *
 * Luật chỉ có hai chiều, không có ngoại lệ theo user hay capability:
 * - Token mang audience `platform` (cấp từ bề mặt đăng nhập quản
 *   trị platform riêng) CHỈ được gọi route mang `@PlatformRoute()`; gọi route nghiệp vụ thường → 403 `auth.audience_denied`.
 * - Token nghiệp vụ thường (không mang audience platform) CHỈ được
 *   gọi route nghiệp vụ; gọi route vận hành platform → 403 `auth.audience_denied`. Route `@Public()` không qua cổng này (chưa có danh tính để xét); request chưa có danh tính thì `JwtAuthGuard` đã xử lý trước. Phiên cookie Better Auth không mang audience nên được coi là token nghiệp vụ — muốn vận hành platform thì đăng nhập lấy token platform, không dùng phiên cookie.
 */
@Injectable()
export class AudienceGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) return true;
    const isPlatformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Support token tuyệt đối không được truy cập control plane hay
    // nghiệp vụ; platform-admin token cũng không tự dùng hỗ trợ nếu
    // chưa đăng nhập vào audience support được cấp riêng.
    const isSupportRoute = this.reflector.getAllAndOverride<boolean>(IS_SUPPORT_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Audience kỳ vọng theo bề mặt route: support → 'support',
    // platform → 'platform', route nghiệp vụ thường → không mang
    // audience (undefined).
    let expectedAudience: 'support' | 'platform' | undefined;
    if (isSupportRoute) expectedAudience = 'support';
    else if (isPlatformRoute) expectedAudience = 'platform';
    else expectedAudience = undefined;
    if (user.audience !== expectedAudience) {
      throw new ForbiddenException({
        message: 'Token audience does not match this API surface',
        code: 'auth.audience_denied',
      });
    }
    return true;
  }
}
