import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { forbidden, unauthorized } from '../../common/http-errors';
import { Reflector } from '@nestjs/core';
import { AUTHENTICATED_VIA_BETTER_AUTH } from '../../common/better-auth-session.guard';
import type { AuthenticatedUser } from '../../common/current-user.decorator';
import { SpaceRoutingError, type ResolvedSpaceConnection } from '../../db/routing/space-connection-resolver';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SKIP_SPACE_CONTEXT_KEY } from './skip-space-context.decorator';
import { spaceSlugForHost } from './space-resolution';
import { tenantAls } from './tenant-als';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';

@Injectable()
export class SpaceContextGuard implements CanActivate {
  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly repo: TenantsRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_SPACE_CONTEXT_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      tenantId?: string;
      spaceSlug?: string;
      spaceId?: string;
      spaceHandle?: object;
      headers: Record<string, string | string[] | undefined>;
      [AUTHENTICATED_VIA_BETTER_AUTH]?: boolean;
    }>();
    const hostHeader = request.headers?.host;
    const slug = spaceSlugForHost(hostHeader);
    if (!slug) {
      if (request.user?.centreId !== undefined) {
        const platformTenant = await tenantAls.run({ platform: true }, () => this.repo.getPlatformTenant());
        let platformRoot = false;
        if (platformTenant && request.tenantId === platformTenant.id) {
          try {
            const target = await this.spaceDb.resolveTarget(platformTenant.slug);
            platformRoot = target.spaceId === request.user.centreId;
          } catch {
          }
        }
        if (!platformRoot) {
          unauthorized('Centre session requires its registered centre address', 'auth.centre_mismatch');
        }
      }
      return true;
    }

    const target: ResolvedSpaceConnection = await this.spaceDb.resolveTarget(slug);

    if (target.status !== 'active') {
      forbidden(`Space ${slug} is ${target.status}`, 'space.not_active');
    }

    const user = request.user;
    if (target.mode === 'dedicated' && user) {
      if (user.centreId !== undefined) {
        if (user.centreId !== target.spaceId) {
          unauthorized('Access token was issued for a different centre', 'auth.centre_mismatch');
        }
      } else if (request[AUTHENTICATED_VIA_BETTER_AUTH]) {
        const tenantId = request.tenantId;
        const effectiveTenant = tenantId
          ? await this.spaceDb.withSpaceKysely(
              slug,
              () => this.repo.getTenant(tenantId),
              { tenantId },
            )
          : undefined;
        if (!effectiveTenant || effectiveTenant.slug !== slug) {
          unauthorized('Session is not bound to the centre at this address', 'auth.centre_mismatch');
        }
      } else {
        unauthorized('Access token carries no centre claim for this dedicated centre; sign in again at this centre address', 'auth.centre_mismatch');
      }
    }

    const db = await this.spaceDb.getKyselyForSpace(slug);
    const binding = this.spaceDb.preparedSpaceScope(slug, db);
    if ((target.mode === 'dedicated' && binding.spaceId !== target.spaceId)
      || (target.mode === 'shared' && !!binding.spaceId)) {
      throw new SpaceRoutingError('space_routing.prepared_identity_mismatch', `Space ${slug} changed while preparing request`);
    }
    request.spaceSlug = slug;
    request.spaceId = binding.spaceId;
    request.spaceHandle = binding.spaceHandle;
    const store = tenantAls.getStore();
    if (store && !store.spaceSlug) {
      tenantAls.enterWith({ ...store, spaceSlug: slug, ...binding });
    }
    return true;
  }
}
