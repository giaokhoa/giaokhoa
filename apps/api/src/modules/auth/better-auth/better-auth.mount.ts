import type { NestExpressApplication } from '@nestjs/platform-express';
import { attachSecurityHeadersToRawRoutes } from '../../../common/security-headers.middleware';
import { toNodeHandler } from 'better-auth/node';
import type { NextFunction, Request, Response } from 'express';
import type { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import { tenantAls } from '../../tenants/tenant-als';
import { resolveDedicatedSpace } from '../../tenants/space-resolution';
import { BETTER_AUTH_BASE_PATH, type BetterAuthInstance } from './better-auth.instance';

const LEGACY_AUTH_SEGMENTS = new Set([
  'login',
  'public',
  'platform',
  'token',
  'mfa',
  'refresh',
  'logout',
  'change-password',
  'login-as',
  'session',
  'sessions',
  'oauth',
  'tenants',
  'switch-tenant',
  'two-factor',
]);

export type BetterAuthSpaceRouting = Pick<SpaceDatabaseService, 'resolveTarget' | 'getKyselyForSpace' | 'preparedSpaceScope'>;

export function mountBetterAuth(
  app: NestExpressApplication,
  auth: BetterAuthInstance,
  spaceDb?: BetterAuthSpaceRouting,
): void {
  const server = app.getHttpAdapter().getInstance() as {
    use: import('express').Express['use'];
    all: (path: string, handler: (req: Request, res: Response, next: NextFunction) => void) => void;
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
  };
  attachSecurityHeadersToRawRoutes(server, [
    BETTER_AUTH_BASE_PATH,
    '/.well-known/oauth-authorization-server',
  ]);
  const handler = toNodeHandler(auth);
  server.all(`${BETTER_AUTH_BASE_PATH}/*splat`, async (req: Request, res: Response, next: NextFunction) => {
    const segment = req.path.slice(BETTER_AUTH_BASE_PATH.length + 1).split('/')[0];
    if (segment && LEGACY_AUTH_SEGMENTS.has(segment)) {
      next();
      return;
    }
    if (!spaceDb) {
      handler(req, res);
      return;
    }
    let space: Awaited<ReturnType<typeof resolveDedicatedSpace>>;
    try {
      space = await resolveDedicatedSpace(spaceDb, req.headers.host);
    } catch (err) {
      next(err);
      return;
    }
    if (!space) {
      handler(req, res);
      return;
    }
    let pinnedHandle: object;
    try {
      const db = await spaceDb.getKyselyForSpace(space.slug);
      const prepared = spaceDb.preparedSpaceScope(space.slug, db);
      if (prepared.spaceId !== space.spaceId || !prepared.spaceHandle) {
        throw new Error('space_routing.prepared_identity_mismatch: Better Auth space changed');
      }
      pinnedHandle = prepared.spaceHandle;
    } catch (err) {
      next(err);
      return;
    }
    tenantAls.run({ spaceSlug: space.slug, spaceId: space.spaceId, spaceHandle: pinnedHandle }, () => {
      handler(req, res);
    });
  });
  server.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
    const queryIndex = req.url.indexOf('?');
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    const rewritten = `${BETTER_AUTH_BASE_PATH}/.well-known/oauth-authorization-server${query}`;
    req.url = rewritten;
    (req as Request & { originalUrl?: string }).originalUrl = rewritten;
    handler(req, res);
  });
  server.all('/.well-known/oauth-authorization-server/*splat', (req: Request, res: Response) => {
    handler(req, res);
  });
}
