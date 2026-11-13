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
  tenantId: string | null;
  spaceSlug: string | null;
  spaceId?: string | null;
}

export interface MessagingHandshake {
  auth?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

const SESSION_COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)(?:__Secure-)?${BETTER_AUTH_SESSION_COOKIE}=`);

@Injectable()
export class MessagingSocketAuth {
  private readonly jwt: JwtService;
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
    this.allowLocalRoot = environment === 'test' || environment === 'development';
  }

  async authenticateHandshake(handshake: MessagingHandshake): Promise<MessagingSocketIdentity | null> {
    const hostHeader = handshake.headers['host'];
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    const space = await resolveDedicatedSpace(this.spaceDb, hostHeader);
    if (space) await this.spaceDb.getKyselyForSpace(space.slug);
    const viaCookie = await this.authenticateCookie(handshake.headers, space);
    if (viaCookie) return viaCookie;
    const isRootHost = this.isTrustedRootHost(host);
    return this.authenticate(extractHandshakeToken(handshake), space, isRootHost);
  }

  private isTrustedRootHost(host: string | undefined): boolean {
    if (extractSpaceSlugFromHost(host)) return false;
    const hostname = hostnameFromHostHeader(host);
    if (!hostname) return false;
    if (this.publicRootHostname && hostname === this.publicRootHostname) return true;
    return this.allowLocalRoot && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  }

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
      return null;
    }
    if (!resolved) return null;
    const readUser = () => this.users.getByIdOrUndefined(resolved.session.userId);
    let user: Awaited<ReturnType<typeof readUser>>;
    try {
      user = space ? await this.spaceDb.withSpaceKysely(space.slug, readUser) : await readUser();
    } catch {
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
        if (!isRootHost || tid === undefined) return null;
        const platform = await this.tenants.platformTenant();
        if (tid !== platform.id) return null;
        try {
          const registered = await this.spaceDb.resolveTarget(platform.slug);
          if (registered.spaceId !== payload.centre_id) return null;
        } catch {
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

function extractHandshakeToken(handshake: MessagingHandshake): string | undefined {
  const authToken = (handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof authToken === 'string' && authToken.length > 0) return authToken;
  const header = handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return undefined;
}
