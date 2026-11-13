import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/current-user.decorator';
import { Reflector } from '@nestjs/core';
import { IS_PLATFORM_ROUTE_KEY } from '../../common/platform-route.decorator';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { resolveDedicatedSpace } from './space-resolution';
import { isPublicLearningHost, PUBLIC_LEARNING_SLUG } from './public-learning';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import { tenantAls } from './tenant-als';
import { TenantsService } from './tenants.service';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly repo: TenantsRepository,
    private readonly tenants: TenantsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly tenantContext: TenantContextService,
    private readonly spaceDb: SpaceDatabaseService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    return tenantAls.run({ platform: true }, () => this.resolveRequestTenant(context));
  }

  private async resolveRequestTenant(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      tenantId?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const zero = await this.repo.getPlatformTenant();
    if (!zero) return true;
    const user = request.user;
    const platformRoute = this.reflector?.getAllAndOverride<boolean>(IS_PLATFORM_ROUTE_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!user && !platformRoute && isPublicLearningHost(request.headers?.host)) {
      const space = await resolveDedicatedSpace(this.spaceDb, request.headers?.host);
      if (!space || space.slug !== PUBLIC_LEARNING_SLUG) {
        throw new UnauthorizedException({ message: 'Public learning store is not ready', code: 'public_learning.store_unavailable' });
      }
      const publicTenant = await this.spaceDb.withSpaceKysely(space.slug, () =>
        this.repo.getTenantBySlug(PUBLIC_LEARNING_SLUG),
      );
      if (!publicTenant || publicTenant.kind !== 'platform' || publicTenant.status !== 'active') {
        throw new UnauthorizedException({ message: 'Public learning tenant is not active', code: 'public_learning.tenant_unavailable' });
      }
      this.tenantContext.enter({ tenantId: publicTenant.id });
      request.tenantId = publicTenant.id;
      return true;
    }
    if (user) {
      const space = await resolveDedicatedSpace(this.spaceDb, request.headers?.host);
      const isPlatformSession = user.tenantId !== undefined && user.tenantId === zero.id && user.centreId === undefined;
      if (space && !isPlatformSession) {
        const spaceTenant = await this.spaceDb.withSpaceKysely(space.slug, () =>
          this.repo.getTenantBySlug(space.slug),
        );
        if (!spaceTenant) {
          throw new UnauthorizedException({
            message: 'Space tenant is not ready in its own store',
            code: 'space.tenant_missing',
          });
        }
        if (spaceTenant.status !== 'active') {
          throw new ForbiddenException({
            message: `Tenant ${spaceTenant.slug} is ${spaceTenant.status}`,
            code: 'tenant.not_active',
          });
        }
        if (spaceTenant.kind !== 'platform') {
          const membership = await this.spaceDb.withSpaceKysely(space.slug, () =>
            this.repo.getMembership(spaceTenant.id, user.id),
          );
          if (membership?.status !== 'active') {
            throw new UnauthorizedException({
              message: 'Membership in the active tenant is no longer active',
              code: 'tenant.membership_inactive',
            });
          }
        }
        this.tenantContext.enter({ tenantId: spaceTenant.id, userId: user.id });
        request.tenantId = spaceTenant.id;
        return true;
      }
    }
    let tenantId = zero.id;
    if (user) {
      if (user.tenantId) {
        const tenant = await this.repo.getTenant(user.tenantId);
        if (!tenant) {
          throw new UnauthorizedException({
            message: 'Tenant declared by the session could not be resolved',
            code: 'tenant.unknown',
          });
        }
        if (tenant.status !== 'active') {
          throw new ForbiddenException({
            message: `Tenant ${tenant.slug} is ${tenant.status}`,
            code: 'tenant.not_active',
          });
        }
        if (tenant.kind === 'platform') {
          tenantId = tenant.id;
        } else {
          const membership = await this.repo.getMembership(tenant.id, user.id);
          if (membership?.status === 'active') {
            tenantId = tenant.id;
          } else if (await this.evaluator.isSiteAdmin(user.id)) {
            tenantId = zero.id;
          } else {
            throw new UnauthorizedException({
              message: 'Membership in the active tenant is no longer active',
              code: 'tenant.membership_inactive',
            });
          }
        }
      } else {
        tenantId = (await this.tenants.resolveDefaultTenant(user.id)).id;
      }
    }
    this.tenantContext.enter({ tenantId, userId: user?.id });
    request.tenantId = tenantId;
    return true;
  }
}
