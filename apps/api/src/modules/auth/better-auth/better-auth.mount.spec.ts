import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../auth.controller';
import { OAuthController } from '../oauth.controller';
import { PublicRegistrationController } from '../public-registration.controller';
import { LEGACY_AUTH_SEGMENTS } from './better-auth.mount';
import { TwoFactorCompletionController } from './two-factor-completion.controller';

/**
 * Hồi quy HOTFIX #196: `LEGACY_AUTH_SEGMENTS` trong `better-auth.mount.ts` là allowlist thủ công — thiếu một segment đầu của route auth tự viết dưới `/auth` thì request đó bị handler Better Auth nuốt và trả 404 rỗng khi Better Auth được mount (đúng sự cố triển khai TENANT-1: thiếu `tenants` và `switch-tenant`).
 *
 * Test này suy ra mọi segment đầu từ metadata route của chính các controller (`PATH_METADATA` do `@Controller`/`@Get`/`@Post`/… ghi, đọc qua `Reflector`) rồi khẳng định từng segment đều có mặt trong allowlist — thêm route con mới dưới `/auth` mà quên thêm segment thì test này đỏ trước khi lỗi lặp lại. Test chỉ khẳng định chiều "controller → allowlist": allowlist thừa segment của route đã gỡ thì không đỏ, vì đó chỉ là nhánh chết vô hại, không nuốt request.
 */
describe('Better Auth mount — mọi route auth tự viết đều được chừa cho Nest', () => {
  it('mọi segment đầu của các controller dưới /auth đều có mặt trong LEGACY_AUTH_SEGMENTS', () => {
    const segments = firstSegmentsUnderAuth([
      AuthController,
      OAuthController,
      PublicRegistrationController,
      TwoFactorCompletionController,
    ]);
    expect(segments.size).toBeGreaterThan(0);
    const missing = [...segments].filter((segment) => !LEGACY_AUTH_SEGMENTS.has(segment));
    expect(missing).toEqual([]);
  });
});

/** Kiểu tối thiểu của một class controller để đọc metadata route từ prototype của nó. */
type AuthControllerClass = new (...args: never[]) => object;

/**
 * Suy ra tập segment đầu (phần sau `/auth/`) của mọi route mà các controller khai — từ đường dẫn controller + đường dẫn từng method trong metadata NestJS.
 */
function firstSegmentsUnderAuth(controllers: AuthControllerClass[]): Set<string> {
  const reflector = new Reflector();
  const segments = new Set<string>();
  for (const controller of controllers) {
    const base = reflector.get<string | string[]>(PATH_METADATA, controller);
    const basePath = Array.isArray(base) ? base[0] : base;
    if (!basePath) continue;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const method = (controller.prototype as Record<string, unknown>)[name];
      if (typeof method !== 'function') continue;
      const route = reflector.get<string | string[]>(PATH_METADATA, method);
      if (route === undefined) continue;
      const routePath = Array.isArray(route) ? route[0] : route;
      const parts = [basePath, routePath].filter(Boolean).join('/').split('/').filter(Boolean);
      // Phần đầu là `auth` (tiền tố chung); segment mount dùng để phân biệt route cũ là phần ngay sau nó.
      if (parts[0] === 'auth' && parts[1]) segments.add(parts[1]);
    }
  }
  return segments;
}
