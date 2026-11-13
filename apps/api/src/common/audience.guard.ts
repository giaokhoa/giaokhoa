import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './current-user.decorator';
import { IS_PLATFORM_ROUTE_KEY } from './platform-route.decorator';
import { IS_SUPPORT_ROUTE_KEY } from './support-route.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

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
    const isSupportRoute = this.reflector.getAllAndOverride<boolean>(IS_SUPPORT_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const expectedAudience = isSupportRoute
      ? 'support'
      : isPlatformRoute
        ? 'platform'
        : undefined;
    if (user.audience !== expectedAudience) {
      throw new ForbiddenException({
        message: 'Token audience does not match this API surface',
        code: 'auth.audience_denied',
      });
    }
    return true;
  }
}
