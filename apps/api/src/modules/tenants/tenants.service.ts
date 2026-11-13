import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MyTenant, Tenant as TenantDto, TenantMembership as TenantMembershipDto } from '@giaokhoa/contracts';
import { ensureActiveTenantMembership } from '@giaokhoa/enrol';
import {
  DEFAULT_SCHOOL_TENANT_SLUG,
  PLATFORM_TENANT_SLUG,
  TenantsRepository,
  type TenantMembershipRow,
  type TenantRow,
} from '@giaokhoa/db/repositories/tenants';
import type { UserRow } from '@giaokhoa/db/repositories/users';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { PlanLimitsService } from '../access/plan-limits.service';
import { UsersService } from '../users/users.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { tenantAls } from './tenant-als';
import { PUBLIC_LEARNING_SLUG } from './public-learning';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingError } from '../../db/routing/space-connection-resolver';
import type {
  AddTenantMemberDto,
  CreateTenantDto,
  CreateTenantUserDto,
  UpdateTenantDto,
} from './dto/tenants.dto';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;

export function toTenantDto(row: TenantRow): TenantDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind as TenantDto['kind'],
    status: row.status as TenantDto['status'],
    plan: row.plan,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMembershipDto(row: TenantMembershipRow): TenantMembershipDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    status: row.status as TenantMembershipDto['status'],
    joinedAt: row.joinedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

export interface TenantUserView {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  suspended: boolean;
  deleted: boolean;
}

export function toTenantUserView(row: UserRow): TenantUserView {
  return {
    id: row.id,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    suspended: row.suspended,
    deleted: row.deleted,
  };
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly repo: TenantsRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly planLimits: PlanLimitsService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}


  async platformTenant(): Promise<TenantRow> {
    const publicStore = tenantAls.getStore()?.spaceSlug === PUBLIC_LEARNING_SLUG;
    return tenantAls.run(
      { platform: true, ...(publicStore ? { spaceSlug: PUBLIC_LEARNING_SLUG, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) },
      () => this.platformTenantInContext(),
    );
  }

  private async platformTenantInContext(): Promise<TenantRow> {
    const slug = tenantAls.getStore()?.spaceSlug === PUBLIC_LEARNING_SLUG
      ? PUBLIC_LEARNING_SLUG
      : PLATFORM_TENANT_SLUG;
    const zero = await this.repo.getTenantBySlug(slug);
    if (!zero) throw new NotFoundException({ message: 'Platform tenant (tenant-zero) is not seeded', code: 'tenant.platform_missing' });
    return zero;
  }

  async ensurePlatformTenant(): Promise<TenantRow> {
    return tenantAls.run({ platform: true }, () => this.ensurePlatformTenantInContext());
  }

  private async ensurePlatformTenantInContext(): Promise<TenantRow> {
    let zero = await this.repo.getTenantBySlug(PLATFORM_TENANT_SLUG);
    if (!zero) {
      zero = await this.repo.insertTenant({
        slug: PLATFORM_TENANT_SLUG,
        name: 'Trang chính',
        kind: 'platform',
        status: 'active',
        plan: null,
      });
    }
    await this.contexts.ensureTenantContext(zero.id);
    return zero;
  }

  async ensureDefaultSchoolTenant(name: string): Promise<TenantRow> {
    return tenantAls.run({ platform: true }, () => this.ensureDefaultSchoolTenantInContext(name));
  }

  private async ensureDefaultSchoolTenantInContext(name: string): Promise<TenantRow> {
    let tenant = await this.repo.getTenantBySlug(DEFAULT_SCHOOL_TENANT_SLUG);
    if (!tenant) {
      tenant = await this.repo.insertTenant({
        slug: DEFAULT_SCHOOL_TENANT_SLUG,
        name,
        kind: 'school',
        status: 'active',
        plan: null,
      });
    }
    await this.contexts.ensureTenantContext(tenant.id);
    return tenant;
  }

  async getTenantInSpace(slug: string): Promise<TenantRow | undefined> {
    return tenantAls.run({ platform: true }, () =>
      this.spaceDb.withSpaceKysely(slug, () => this.repo.getTenantBySlug(slug)),
    );
  }

  async getMembershipInSpace(slug: string, tenantId: string, userId: string): Promise<TenantMembershipRow | undefined> {
    return tenantAls.run({ platform: true }, () =>
      this.spaceDb.withSpaceKysely(slug, () => this.repo.getMembership(tenantId, userId)),
    );
  }

  async getTenant(id: string): Promise<TenantRow> {
    const row = await this.repo.getTenant(id);
    if (!row) throw new NotFoundException({ message: `Tenant ${id} not found`, code: 'tenant.not_found' });
    return row;
  }

  async fallbackTenantId(): Promise<string> {
    return (await this.platformTenant()).id;
  }

  async isPlatformSupportMember(userId: string): Promise<boolean> {
    return tenantAls.run({ platform: true }, async () => {
      const platform = await this.platformTenant();
      const member = await this.repo.getMembership(platform.id, userId);
      return member?.status === 'active';
    });
  }


  private async systemContextId(): Promise<string> {
    return (await this.contexts.ensureSystemContext()).id;
  }

  async assertPlatformManager(actorId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, 'tenant:manage', await this.systemContextId());
  }

  private async isOwnCentreAdmin(actorId: string, tenantId: string): Promise<boolean> {
    const store = tenantAls.getStore();
    if (!store?.spaceSlug) return false;
    const { tenant, membership } = await tenantAls.run({ ...store, platform: true }, async () => ({
      tenant: await this.repo.getTenant(tenantId),
      membership: await this.repo.getMembership(tenantId, actorId),
    }));
    if (tenant?.kind !== 'center' || tenant.slug !== store.spaceSlug || membership?.status !== 'active') {
      return false;
    }
    return this.evaluator.isSiteAdmin(actorId);
  }

  async assertTenantManager(actorId: string, tenantId: string): Promise<void> {
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    if (await this.evaluator.hasCapability(actorId, 'tenant:manage', tenantCtx.id)) return;
    if (await this.isOwnCentreAdmin(actorId, tenantId)) return;
    throw new ForbiddenException({ message: 'Missing capability tenant:manage', code: 'access.capability_denied' });
  }

  async assertTenantViewer(actorId: string, tenantId: string): Promise<void> {
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    if (
      (await this.evaluator.hasCapability(actorId, 'tenant:manage', tenantCtx.id)) ||
      (await this.evaluator.hasCapability(actorId, 'tenant:viewall', tenantCtx.id))
    ) return;
    if (await this.isOwnCentreAdmin(actorId, tenantId)) return;
    throw new ForbiddenException({ message: 'Missing capability tenant:viewall', code: 'access.capability_denied' });
  }


  async listTenants(actorId: string): Promise<TenantDto[]> {
    return tenantAls.run({ platform: true }, () => this.listTenantsInContext(actorId));
  }

  private async listTenantsInContext(actorId: string): Promise<TenantDto[]> {
    const systemId = await this.systemContextId();
    const canView =
      (await this.evaluator.hasCapability(actorId, 'tenant:viewall', systemId)) ||
      (await this.evaluator.hasCapability(actorId, 'tenant:manage', systemId));
    if (!canView) {
      throw new ForbiddenException({ message: 'Missing capability tenant:viewall', code: 'access.capability_denied' });
    }
    return (await this.repo.listTenants()).map(toTenantDto);
  }

  async spaceTargetForTenant(tenantId: string): Promise<{ slug: string; dedicated: boolean } | null> {
    const contextSlug = tenantAls.getStore()?.spaceSlug;
    const row = await this.tenantRowForTargetResolution(tenantId);
    if (contextSlug && (!row || row.slug !== contextSlug)) {
      throw new NotFoundException({ message: 'Tenant does not belong to the addressed centre', code: 'tenant.not_found' });
    }
    if (!row) return null;
    try {
      const target = await this.spaceDb.resolveTarget(row.slug);
      return { slug: row.slug, dedicated: target.mode === 'dedicated' };
    } catch (err) {
      if (
        !contextSlug &&
        err instanceof SpaceRoutingError &&
        (err.code === 'space_routing.space_not_found' || err.code === 'space_routing.not_configured')
      ) {
        return { slug: row.slug, dedicated: false };
      }
      throw err;
    }
  }

  private async tenantRowForTargetResolution(tenantId: string): Promise<TenantRow | undefined> {
    const contextSlug = tenantAls.getStore()?.spaceSlug;
    if (contextSlug) {
      try {
        const inContextSpace = await tenantAls.run({ platform: true }, () =>
          this.spaceDb.withSpaceKysely(contextSlug, () => this.repo.getTenant(tenantId)),
        );
        if (inContextSpace) return inContextSpace;
      } catch (err) {
        if (
          !(err instanceof SpaceRoutingError) ||
          (err.code !== 'space_routing.space_not_found' && err.code !== 'space_routing.not_configured')
        ) {
          throw err;
        }
      }
      return undefined;
    }
    return tenantAls.run({ platform: true }, () => this.repo.getTenant(tenantId));
  }

  private async runInTenantTargetStore<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const target = await this.spaceTargetForTenant(tenantId);
    if (target?.dedicated) {
      return tenantAls.run({ platform: true }, () => this.spaceDb.withSpaceKysely(target.slug, fn));
    }
    return tenantAls.run({ platform: true }, fn);
  }

  async getTenantForActor(actorId: string, tenantId: string): Promise<TenantDto> {
    return this.runInTenantTargetStore(tenantId, () => this.getTenantForActorInContext(actorId, tenantId));
  }

  private async getTenantForActorInContext(actorId: string, tenantId: string): Promise<TenantDto> {
    const tenant = await this.getTenant(tenantId);
    await this.assertTenantViewer(actorId, tenantId);
    return toTenantDto(tenant);
  }

  async createTenant(actorId: string, dto: CreateTenantDto): Promise<TenantDto> {
    return tenantAls.run({ platform: true }, () => this.createTenantInContext(actorId, dto));
  }

  private async createTenantInContext(actorId: string, dto: CreateTenantDto): Promise<TenantDto> {
    await this.assertPlatformManager(actorId);
    if (dto.kind === 'center') {
      throw new BadRequestException({
        message: 'New centres require dedicated provisioning; use the space-provision operator command',
        code: 'centre.provision_required',
      });
    }
    const slug = dto.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new BadRequestException({ message: `Invalid tenant slug: ${dto.slug}`, code: 'tenant.invalid_slug' });
    }
    if (await this.repo.getTenantBySlug(slug)) {
      throw new ConflictException({ message: `Tenant slug ${slug} is already taken`, code: 'tenant.slug_taken' });
    }
    const tenant = await this.repo.insertTenant({
      slug,
      name: dto.name.trim(),
      kind: dto.kind,
      status: 'active',
      plan: dto.plan ?? null,
    });
    await this.contexts.ensureTenantContext(tenant.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'tenant',
      type: 'tenant_created',
      payload: { tenantId: tenant.id, slug, kind: dto.kind, actorId },
      tenantId: tenant.id,
    });
    return toTenantDto(tenant);
  }

  async updateTenant(actorId: string, tenantId: string, dto: UpdateTenantDto): Promise<TenantDto> {
    return tenantAls.run({ platform: true }, () => this.updateTenantInContext(actorId, tenantId, dto));
  }

  private async updateTenantInContext(actorId: string, tenantId: string, dto: UpdateTenantDto): Promise<TenantDto> {
    await this.assertPlatformManager(actorId);
    const tenant = await this.getTenant(tenantId);
    if (tenant.kind === 'platform' && dto.status !== undefined && dto.status !== 'active') {
      throw new BadRequestException({ message: 'The platform tenant cannot be suspended or archived', code: 'tenant.platform_immutable_status' });
    }
    const patch: Partial<TenantRow> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.plan !== undefined) patch.plan = dto.plan;
    if (Object.keys(patch).length) await this.repo.updateTenant(tenantId, patch);
    if (dto.status !== undefined && dto.status !== tenant.status) {
      const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
      await this.contexts.markContextDirty(tenantCtx.id);
      await this.outbox.enqueueStandalone({
        aggregate: 'tenant',
        type: 'tenant_status_changed',
        payload: { tenantId, from: tenant.status, to: dto.status, actorId },
        tenantId,
      });
    }
    return toTenantDto(await this.getTenant(tenantId));
  }


  async ensureActiveMembership(tenantId: string, userId: string): Promise<TenantMembershipRow> {
    return ensureActiveTenantMembership(this.spaceDb.routedKysely, tenantId, userId);
  }

  async addMember(actorId: string, tenantId: string, dto: AddTenantMemberDto): Promise<TenantMembershipDto> {
    return this.runInTenantTargetStore(tenantId, () => this.addMemberInContext(actorId, tenantId, dto));
  }

  private async addMemberInContext(actorId: string, tenantId: string, dto: AddTenantMemberDto): Promise<TenantMembershipDto> {
    await this.assertTenantManager(actorId, tenantId);
    const tenant = await this.getTenant(tenantId);
    if (tenant.status !== 'active') {
      throw new BadRequestException({ message: `Tenant ${tenantId} is not active`, code: 'tenant.not_active' });
    }
    const user = await this.users.getUser(dto.userId);
    const existingMembership = await this.repo.getMembership(tenantId, user.id);
    if (existingMembership?.status !== 'active' && !user.suspended && !user.deleted) {
      if (await this.planLimits.userHoldsTeachingRoleInTenant(tenantId, user.id)) {
        await this.planLimits.assertTenantSlotForNewTeacher(tenantId, user.id);
      }
    }
    const row = await this.ensureActiveMembership(tenantId, user.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'tenant',
      type: 'tenant_member_added',
      payload: { tenantId, userId: user.id, actorId },
      tenantId,
    });
    return toMembershipDto(row);
  }

  async setMemberStatus(
    actorId: string,
    tenantId: string,
    userId: string,
    status: 'active' | 'suspended' | 'ended',
  ): Promise<TenantMembershipDto> {
    return this.runInTenantTargetStore(tenantId, () =>
      this.setMemberStatusInContext(actorId, tenantId, userId, status),
    );
  }

  private async setMemberStatusInContext(
    actorId: string,
    tenantId: string,
    userId: string,
    status: 'active' | 'suspended' | 'ended',
  ): Promise<TenantMembershipDto> {
    await this.assertTenantManager(actorId, tenantId);
    const existing = await this.repo.getMembership(tenantId, userId);
    if (!existing) throw new NotFoundException({ message: 'Membership not found', code: 'tenant.membership_not_found' });
    if (status === 'active' && existing.status !== 'active') {
      const user = await this.users.getUser(userId);
      if (!user.suspended && !user.deleted) {
        if (await this.planLimits.userHoldsTeachingRoleInTenant(tenantId, userId)) {
          await this.planLimits.assertTenantSlotForNewTeacher(tenantId, userId);
        }
      }
    }
    await this.repo.updateMembership(existing.id, {
      status,
      endedAt: status === 'ended' ? new Date() : null,
    });
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    await this.contexts.markContextDirty(tenantCtx.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'tenant',
      type: status === 'active' ? 'tenant_member_reactivated' : 'tenant_member_status_changed',
      payload: { tenantId, userId, status, actorId },
      tenantId,
    });
    return toMembershipDto({ ...existing, status, endedAt: status === 'ended' ? new Date() : null });
  }

  async listMembers(actorId: string, tenantId: string): Promise<TenantMembershipDto[]> {
    return this.runInTenantTargetStore(tenantId, () => this.listMembersInContext(actorId, tenantId));
  }

  private async listMembersInContext(actorId: string, tenantId: string): Promise<TenantMembershipDto[]> {
    await this.assertTenantViewer(actorId, tenantId);
    return (await this.repo.listMembershipsForTenant(tenantId)).map(toMembershipDto);
  }


  async createTenantUser(actorId: string, tenantId: string, dto: CreateTenantUserDto): Promise<TenantUserView> {
    const target = await this.spaceTargetForTenant(tenantId);
    if (target?.dedicated) {
      return this.createTenantUserInSpace(actorId, target.slug, dto);
    }
    return tenantAls.run({ platform: true }, async () => {
      await this.getTenant(tenantId);
      return this.createTenantUserInContext(actorId, tenantId, dto);
    });
  }

  private async createTenantUserInSpace(
    actorId: string,
    slug: string,
    dto: CreateTenantUserDto,
  ): Promise<TenantUserView> {
    const spaceTenant = await this.getTenantInSpace(slug);
    if (!spaceTenant) {
      throw new NotFoundException({ message: `Tenant ${slug} is not ready in its own store`, code: 'tenant.not_found' });
    }
    const view = await this.spaceDb.withSpaceKysely(slug, async () => {
      await this.assertTenantManager(actorId, spaceTenant.id);
      const user = await this.users.createUser({
        username: dto.username,
        email: dto.email,
        password: dto.password,
        firstName: dto.firstName,
        lastName: dto.lastName,
        forcePasswordChange: dto.forcePasswordChange,
        customFields: dto.customFields,
      });
      await this.ensureActiveMembership(spaceTenant.id, user.id);
      return toTenantUserView(user);
    });
    return view;
  }

  private async createTenantUserInContext(actorId: string, tenantId: string, dto: CreateTenantUserDto): Promise<TenantUserView> {
    await this.assertTenantManager(actorId, tenantId);
    const user = await this.users.createUser({
      username: dto.username,
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      forcePasswordChange: dto.forcePasswordChange,
      customFields: dto.customFields,
    });
    await this.ensureActiveMembership(tenantId, user.id);
    return toTenantUserView(user);
  }

  async listTenantUsers(actorId: string, tenantId: string): Promise<TenantUserView[]> {
    return this.runInTenantTargetStore(tenantId, () => this.listTenantUsersInContext(actorId, tenantId));
  }

  private async listTenantUsersInContext(actorId: string, tenantId: string): Promise<TenantUserView[]> {
    await this.assertTenantViewer(actorId, tenantId);
    const members = await this.repo.listMembershipsForTenant(tenantId);
    if (!members.length) return [];
    const rows = await this.users.getUsersByIds(members.map((m) => m.userId));
    return rows.map(toTenantUserView);
  }


  async listMyTenants(userId: string, activeTenantId?: string): Promise<MyTenant[]> {
    const store = tenantAls.getStore();
    const spaceSlug = store?.spaceSlug;
    const currentTenantId = activeTenantId ?? store?.tenantId;
    return tenantAls.run(
      { platform: true, ...(spaceSlug ? { spaceSlug, spaceId: store?.spaceId, spaceHandle: store?.spaceHandle } : {}) },
      () => this.listMyTenantsInContext(userId, currentTenantId),
    );
  }

  private async listMyTenantsInContext(userId: string, activeTenantId?: string): Promise<MyTenant[]> {
    if (!activeTenantId) return [];
    const tenant = await this.repo.getTenant(activeTenantId);
    if (!tenant || tenant.status !== 'active') return [];
    if (tenant.kind !== 'platform') {
      const membership = await this.repo.getMembership(tenant.id, userId);
      if (membership?.status !== 'active') return [];
    }
    const rows: MyTenant[] = [{
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      kind: tenant.kind as MyTenant['kind'],
      active: true,
    }];
    return rows;
  }

  async resolveDefaultTenant(userId: string): Promise<TenantRow> {
    const publicStore = tenantAls.getStore()?.spaceSlug === PUBLIC_LEARNING_SLUG;
    return tenantAls.run(
      { platform: true, ...(publicStore ? { spaceSlug: PUBLIC_LEARNING_SLUG, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) },
      () => this.resolveDefaultTenantInContext(userId),
    );
  }

  private async resolveDefaultTenantInContext(userId: string): Promise<TenantRow> {
    const zero = await this.platformTenant();
    const memberships = (await this.repo.listMembershipsForUser(userId)).filter((m) => m.status === 'active');
    const tenants: TenantRow[] = [];
    for (const m of memberships) {
      const tenant = await this.repo.getTenant(m.tenantId);
      if (tenant && tenant.status === 'active') tenants.push(tenant);
    }
    if (tenants.length === 1) return tenants[0]!;
    if (tenants.length > 1) {
      if (await this.evaluator.isSiteAdmin(userId)) return zero;
      const nonPlatform = tenants.find((t) => t.kind !== 'platform');
      if (nonPlatform) return nonPlatform;
    }
    return zero;
  }

  async resolveSwitchTarget(userId: string, tenantId: string): Promise<TenantRow> {
    const publicStore = tenantAls.getStore()?.spaceSlug === PUBLIC_LEARNING_SLUG;
    return tenantAls.run(
      { platform: true, ...(publicStore ? { spaceSlug: PUBLIC_LEARNING_SLUG, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) },
      () => this.resolveSwitchTargetInContext(userId, tenantId),
    );
  }

  private async resolveSwitchTargetInContext(userId: string, tenantId: string): Promise<TenantRow> {
    const tenant = await this.getTenant(tenantId);
    if (tenant.status !== 'active') {
      throw new ForbiddenException({ message: `Tenant ${tenant.slug} is ${tenant.status}`, code: 'tenant.not_active' });
    }
    if (tenant.kind !== 'platform') {
      const membership = await this.repo.getMembership(tenantId, userId);
      if (!membership || membership.status !== 'active') {
        throw new ForbiddenException({ message: 'User is not an active member of this tenant', code: 'tenant.not_member' });
      }
    }
    return tenant;
  }
}
