import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { RolesService } from '../access/roles.service';
import { ControlPlaneRegistryService } from '../control-plane/control-plane.service';
import { tenantAls } from '../tenants/tenant-als';
import { TenantsService } from '../tenants/tenants.service';
import type { TenantRow } from '@giaokhoa/db/repositories/tenants';
import { UsersService } from '../users/users.service';
import type { UserRow } from '@giaokhoa/db/repositories/users';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);
  constructor(
    private readonly roles: RolesService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly tenants: TenantsService,
    private readonly controlPlane: ControlPlaneRegistryService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    await tenantAls.run({ platform: true }, () => this.seedInPlatformContext());
  }

  private async seedInPlatformContext(): Promise<void> {
    await this.roles.seedDefaults();
    await this.users.ensureGuestUser();
    const zero = await this.tenants.ensurePlatformTenant();
    const admins = (await this.currentSiteAdmins());
    let admin: UserRow | undefined;
    if (admins.length === 0) {
      const username = this.config.get<string>('ADMIN_USERNAME') ?? 'admin';
      admin = await this.users.getByUsername(username);
      if (!admin) {
        admin = await this.users.createUser({
          username,
          email: this.config.get<string>('ADMIN_EMAIL') ?? 'admin@localhost',
          password: this.config.get<string>('ADMIN_PASSWORD') ?? 'Admin123!',
          firstName: 'Site', lastName: 'Administrator',
        });
      }
      const system = await this.contexts.ensureSystemContext();
      const manager = await this.roles.getRoleByShortname('manager');
      if (manager) await this.roles.assignRole(admin.id, manager.id, system.id);
      await this.evaluator.setSiteAdmins([admin.id]);
      this.logger.log(`Seeded initial site administrator "${username}" (id ${admin.id})`);
    } else {
      admin = await this.users.getByIdOrUndefined(admins[0]!);
    }
    if (admin) {
      await this.tenants.ensureActiveMembership(zero.id, admin.id);
      const manager = await this.roles.getRoleByShortname('manager');
      if (manager) {
        await this.assignRoleIfMissing(admin.id, manager.id, (await this.contexts.ensureTenantContext(zero.id)).id);
      }
    }
    await this.ensurePlatformOperator(zero.id);
    await this.seedControlPlaneRegistry(zero);
  }

  private async assignRoleIfMissing(userId: string, roleId: string, contextId: string): Promise<void> {
    const existing = (await this.roles.listAssignments({ userId, contextId })) as { roleId: string }[];
    if (existing.some((a) => a.roleId === roleId)) return;
    await this.roles.assignRole(userId, roleId, contextId);
  }

  private async ensurePlatformOperator(platformTenantId: string): Promise<void> {
    const username = this.config.get<string>('PLATFORM_ADMIN_USERNAME');
    if (!username) return;
    const bootstrapUsername = this.config.get<string>('ADMIN_USERNAME') ?? 'admin';
    if (username === bootstrapUsername) return;
    let operator = await this.users.getByUsername(username);
    if (!operator) {
      operator = await this.users.createUser({
        username,
        email: this.config.get<string>('PLATFORM_ADMIN_EMAIL') ?? `${username}@localhost`,
        password: this.config.get<string>('PLATFORM_ADMIN_PASSWORD') ?? 'Platform123!',
        firstName: 'Platform', lastName: 'Operator',
      });
      this.logger.log(`Seeded platform operator "${username}" (id ${operator.id})`);
    }
    const admins = await this.currentSiteAdmins();
    if (!admins.includes(operator.id)) {
      await this.evaluator.setSiteAdmins([...admins, operator.id]);
    }
    await this.tenants.ensureActiveMembership(platformTenantId, operator.id);
  }

  private async currentSiteAdmins(): Promise<string[]> {
    return this.evaluator.listSiteAdmins();
  }

  private async seedControlPlaneRegistry(zero: TenantRow): Promise<void> {
    if (!this.controlPlane.isConfigured) return;
    const businessUrl = new URL(this.config.get<string>('DATABASE_URL')!);
    const databaseName = decodeURIComponent(businessUrl.pathname.replace(/^\//, ''));
    const connectionRoleRef = decodeURIComponent(businessUrl.username);
    await this.controlPlane.seedExistingSpaces([{
      slug: zero.slug,
      name: zero.name,
      kind: 'platform',
      plan: zero.plan,
      databaseName,
      connectionRoleRef,
      secretRef: 'env:DATABASE_URL',
    }]);
  }
}
