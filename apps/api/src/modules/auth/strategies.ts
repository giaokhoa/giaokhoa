import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../common/current-user.decorator';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { resolveDedicatedSpace } from '../tenants/space-resolution';
import { isPublicLearningHost } from '../tenants/public-learning';
import { TenantsService } from '../tenants/tenants.service';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

interface SpaceAwareRequest {
  headers?: Record<string, string | string[] | undefined>;
}


@Injectable()
export class LocalAuthStrategy extends PassportStrategy(LocalStrategy, 'local') {
  constructor(
    private readonly auth: AuthService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {
    super({ passReqToCallback: true });
  }
  async validate(
    req: SpaceAwareRequest,
    username: string,
    password: string,
  ): Promise<{ id: string; username: string }> {
    const space = await resolveDedicatedSpace(this.spaceDb, req.headers?.host);
    const user = space
      ? await this.spaceDb.withSpaceKysely(space.slug, () => this.auth.validateCredentials(username, password))
      : await this.auth.validateCredentials(username, password);
    return { id: user.id, username: user.username };
  }
}

export interface JwtPayload { sub: string; username: string; sid: string; scope?: string;   tid?: string;   centre_id?: string;   aud?: string }

@Injectable()
export class JwtAuthStrategy extends PassportStrategy(JwtStrategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly spaceDb: SpaceDatabaseService,
    private readonly tenants: TenantsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }
  async validate(req: SpaceAwareRequest, payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.scope !== undefined || !payload.sid) {
      throw new UnauthorizedException({ message: 'Token is not an access token', code: 'auth.unauthenticated' });
    }
    const space = (payload.aud === 'platform' || payload.aud === 'support')
      ? null
      : await resolveDedicatedSpace(this.spaceDb, req.headers?.host);
    if (isPublicLearningHost(req.headers?.host) && payload.aud !== 'platform' && payload.aud !== 'support' && !payload.centre_id) {
      throw new UnauthorizedException({ message: 'Public learning requires a store-bound session', code: 'auth.centre_mismatch' });
    }
    if (!space && payload.aud !== 'platform' && payload.aud !== 'support' && payload.tid) {
      const platform = await this.tenants.platformTenant();
      if (payload.tid !== platform.id) {
        throw new UnauthorizedException({
          message: 'A centre token cannot be used at the platform hostname',
          code: 'auth.centre_mismatch',
        });
      }
    }
    if (payload.centre_id !== undefined && (!space || payload.centre_id !== space.spaceId)) {
      let rootIsPlatform = false;
      if (!space && payload.tid !== undefined) {
        const platform = await this.tenants.platformTenant();
        if (payload.tid === platform.id) {
          try {
            const registered = await this.spaceDb.resolveTarget(platform.slug);
            rootIsPlatform = registered.spaceId === payload.centre_id;
          } catch {
          }
        }
      }
      if (!rootIsPlatform) {
        throw new UnauthorizedException({ message: 'Token belongs to another centre or address', code: 'auth.centre_mismatch' });
      }
    }
    const isPlatformSession =
      space !== null &&
      payload.tid !== undefined &&
      payload.centre_id === undefined &&
      payload.tid === (await this.tenants.platformTenant()).id;
    const user = space && !isPlatformSession
      ? await this.spaceDb.withSpaceKysely(space.slug, () => this.users.getByIdOrUndefined(payload.sub))
      : await this.users.getByIdOrUndefined(payload.sub);
    if (!user || user.deleted || user.suspended) {
      throw new UnauthorizedException({ message: 'Account is not active', code: 'auth.account_inactive' });
    }
    return { id: user.id, username: user.username, sessionId: payload.sid, tenantId: payload.tid, centreId: payload.centre_id, audience: payload.aud };
  }
}
