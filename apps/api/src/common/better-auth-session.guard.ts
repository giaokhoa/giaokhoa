import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { BetterAuthService } from '../modules/auth/better-auth/better-auth.service';
import { BETTER_AUTH_SESSION_COOKIE } from '../modules/auth/better-auth/better-auth.instance';
import { SpaceDatabaseService } from '../db/routing/space-database.service';
import { resolveDedicatedSpace } from '../modules/tenants/space-resolution';
import { UsersService } from '../modules/users/users.service';
import type { AuthenticatedUser } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

export const AUTHENTICATED_VIA_BETTER_AUTH = 'authenticatedViaBetterAuth';

interface BetterAuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  [AUTHENTICATED_VIA_BETTER_AUTH]?: boolean;
}

const SESSION_COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)(?:__Secure-)?${BETTER_AUTH_SESSION_COOKIE}=`);

@Injectable()
export class BetterAuthSessionGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly betterAuth: BetterAuthService,
    private readonly users: UsersService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.betterAuth.enabled) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<BetterAuthRequest>();
    const cookie = req.headers['cookie'];
    if (typeof cookie !== 'string' || !SESSION_COOKIE_PATTERN.test(cookie)) return true;

    const auth = this.betterAuth.requireAuth();
    let resolved: Awaited<ReturnType<typeof auth.api.getSession>>;
    let space: Awaited<ReturnType<typeof resolveDedicatedSpace>>;
    try {
      space = await resolveDedicatedSpace(this.spaceDb, req.headers['host']);
      const readSession = () => auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      resolved = space
        ? await this.spaceDb.withSpaceKysely(space.slug, readSession)
        : await readSession();
    } catch {
      return true;
    }
    if (!resolved) return true;
    const sessionUserId = resolved.session.userId;

    let user: Awaited<ReturnType<typeof this.users.getByIdOrUndefined>>;
    try {
      user = space
        ? await this.spaceDb.withSpaceKysely(space.slug, () =>
            this.users.getByIdOrUndefined(sessionUserId),
          )
        : await this.users.getByIdOrUndefined(sessionUserId);
    } catch {
      return true;
    }
    if (!user || user.deleted || user.suspended) return true;

    req.user = { id: user.id, username: user.username, sessionId: resolved.session.id };
    req[AUTHENTICATED_VIA_BETTER_AUTH] = true;
    return true;
  }
}
