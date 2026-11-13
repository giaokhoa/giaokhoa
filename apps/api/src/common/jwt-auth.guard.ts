import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AUTHENTICATED_VIA_BETTER_AUTH } from './better-auth-session.guard';
import type { AuthenticatedUser } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }
  override canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser; [AUTHENTICATED_VIA_BETTER_AUTH]?: boolean }>();
    if (req?.[AUTHENTICATED_VIA_BETTER_AUTH] && req.user) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
  override handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err instanceof UnauthorizedException) {
      const response = err.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) throw err;
    }
    if (err || !user) throw new UnauthorizedException({ message: 'Authentication required', code: 'auth.unauthenticated' });
    return user;
  }
}
