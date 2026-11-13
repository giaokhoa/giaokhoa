import { CONTEXT_LEVELS } from './contexts';
import { SharedDomainError } from './errors';
import type { EnrolDatabase, PlatformScopeRunner } from './types';

const SLOT_CONFIG_DEFAULTS = {
  tenantplanslots: 30,
  teacherplancourseslots: 10,
  tenantplanfreeslots: 3,
  teacherplanfreecourseslots: 1,
  plangracedays: 7,
} as const;
type SlotConfigName = keyof typeof SLOT_CONFIG_DEFAULTS;

export const TEACHING_ROLE_ARCHETYPES = ['editingteacher', 'teacher'] as const;

export interface EffectivePlanLimit {
  limit: number;
  inGracePeriod: boolean;
  hasActivePlan: boolean;
}

export interface TenantSlotFacts {
  membershipActive: boolean;
  accountActive: boolean;
  holdsTeachingRole: boolean;
  counted: boolean;
}

export class PlanLimitsCore {
  constructor(
    private readonly db: EnrolDatabase,
    private readonly runInPlatformScope: PlatformScopeRunner,
  ) {}

  private async readSlotConfig(name: SlotConfigName): Promise<number> {
    const row = await this.db
      .selectFrom('plugin_config')
      .select('plugin_config.value')
      .where((eb) => eb.and([
        eb('plugin_config.plugin', '=', 'payments'),
        eb('plugin_config.name', '=', name),
        eb('plugin_config.tenant_id', 'is', null),
      ]))
      .executeTakeFirst();
    if (row?.value != null) {
      try {
        const parsed: unknown = JSON.parse(row.value);
        if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0) return parsed;
      } catch {
      }
    }
    return SLOT_CONFIG_DEFAULTS[name];
  }

  private async platformTenantId(): Promise<string | null> {
    const row = await this.db
      .selectFrom('tenants')
      .select('tenants.id')
      .where('tenants.kind', '=', 'platform')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  private async tenantKind(tenantId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('tenants')
      .select('tenants.kind')
      .where('tenants.id', '=', tenantId)
      .executeTakeFirst();
    return row?.kind ?? null;
  }

  async tenantIdForContext(contextId: string, tx?: EnrolDatabase): Promise<string | null> {
    const db = tx ?? this.db;
    const row = await db.selectFrom('context').select(CONTEXT_COLUMNS_FOR_TENANT_ID).where('id', '=', contextId).executeTakeFirst();
    if (!row) return null;
    if (row.contextLevel === CONTEXT_LEVELS.TENANT) return row.instanceId;
    const ancestorIds = row.path.split('/').filter((s) => s.length > 0);
    if (ancestorIds.length === 0) return null;
    const ancestors = await db
      .selectFrom('context')
      .select('context.instance_id as instanceId')
      .where((eb) => eb.and([
        eb('context.id', 'in', ancestorIds),
        eb('context.context_level', '=', CONTEXT_LEVELS.TENANT),
      ]))
      .execute();
    return ancestors[0]?.instanceId ?? null;
  }

  private async tenantContext(tenantId: string): Promise<{ id: string; path: string } | null> {
    const row = await this.db
      .selectFrom('context')
      .select(['context.id', 'context.path'])
      .where((eb) => eb.and([
        eb('context.context_level', '=', CONTEXT_LEVELS.TENANT),
        eb('context.instance_id', '=', tenantId),
      ]))
      .executeTakeFirst();
    return row ?? null;
  }

  private async effectiveLimit(
    component: 'tenant_plan' | 'teacher_plan',
    beneficiary: { tenantId: string; userId: string | null },
    planConfig: SlotConfigName,
    freeConfig: SlotConfigName,
  ): Promise<EffectivePlanLimit> {
    const [planLimit, freeLimit, graceDays] = await Promise.all([
      this.readSlotConfig(planConfig),
      this.readSlotConfig(freeConfig),
      this.readSlotConfig('plangracedays'),
    ]);
    const rows = await this.db
      .selectFrom('plan_entitlements')
      .select(['plan_entitlements.starts_at as startsAt', 'plan_entitlements.expires_at as expiresAt'])
      .where((eb) => eb.and([
        eb('plan_entitlements.component', '=', component),
        eb('plan_entitlements.status', '=', 'active'),
        component === 'tenant_plan'
          ? eb.and([
              eb('plan_entitlements.tenant_id', '=', beneficiary.tenantId),
              eb('plan_entitlements.user_id', 'is', null),
            ])
          : eb('plan_entitlements.user_id', '=', beneficiary.userId ?? ''),
      ]))
      .execute();
    const now = Date.now();
    if (rows.some((r) => r.startsAt.getTime() <= now && now < r.expiresAt.getTime())) {
      return { limit: planLimit, inGracePeriod: false, hasActivePlan: true };
    }
    const lastExpiry = rows
      .map((r) => r.expiresAt.getTime())
      .filter((expiry) => expiry <= now)
      .reduce<number | null>((max, expiry) => (max === null || expiry > max ? expiry : max), null);
    if (lastExpiry !== null && now < lastExpiry + graceDays * 86_400_000) {
      return { limit: planLimit, inGracePeriod: true, hasActivePlan: false };
    }
    return { limit: freeLimit, inGracePeriod: false, hasActivePlan: false };
  }

  async effectiveTenantLimit(tenantId: string): Promise<EffectivePlanLimit> {
    return this.effectiveLimit('tenant_plan', { tenantId, userId: null }, 'tenantplanslots', 'tenantplanfreeslots');
  }

  async effectiveTeacherLimit(userId: string): Promise<EffectivePlanLimit> {
    return this.effectiveLimit('teacher_plan', { tenantId: '', userId }, 'teacherplancourseslots', 'teacherplanfreecourseslots');
  }

  async describeUserInTenant(tenantId: string, userId: string): Promise<TenantSlotFacts> {
    return this.runInPlatformScope(async () => {
      const membership = await this.db
        .selectFrom('tenant_memberships')
        .select('tenant_memberships.status')
        .where((eb) => eb.and([
          eb('tenant_memberships.tenant_id', '=', tenantId),
          eb('tenant_memberships.user_id', '=', userId),
        ]))
        .executeTakeFirst();
      const account = await this.db
        .selectFrom('users')
        .select(['users.suspended', 'users.deleted'])
        .where('users.id', '=', userId)
        .executeTakeFirst();
      const membershipActive = membership?.status === 'active';
      const accountActive = !!account && !account.suspended && !account.deleted;
      const holdsTeachingRole = await this.userHoldsTeachingRoleInTenant(tenantId, userId);
      return {
        membershipActive,
        accountActive,
        holdsTeachingRole,
        counted: membershipActive && accountActive && holdsTeachingRole,
      };
    });
  }

  async userHoldsTeachingRoleInTenant(tenantId: string, userId: string): Promise<boolean> {
    const tctx = await this.tenantContext(tenantId);
    if (!tctx) return false;
    const row = await this.db
      .selectFrom('role_assignments')
      .select('role_assignments.id')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('role.archetype', 'in', [...TEACHING_ROLE_ARCHETYPES]),
        eb.or([
          eb('context.id', '=', tctx.id),
          eb('context.path', 'like', `${tctx.path}/%`),
        ]),
      ]))
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  async countTenantTeachingSlots(tenantId: string): Promise<number> {
    return this.runInPlatformScope(async () => {
      const tctx = await this.tenantContext(tenantId);
      if (!tctx) return 0;
      const rows = await this.db
        .selectFrom('role_assignments')
        .select('role_assignments.user_id as userId')
        .distinct()
        .innerJoin('role', 'role.id', 'role_assignments.role_id')
        .innerJoin('context', 'context.id', 'role_assignments.context_id')
        .innerJoin('tenant_memberships', 'tenant_memberships.user_id', 'role_assignments.user_id')
        .innerJoin('users', 'users.id', 'role_assignments.user_id')
        .where((eb) => eb.and([
          eb('role.archetype', 'in', [...TEACHING_ROLE_ARCHETYPES]),
          eb('tenant_memberships.tenant_id', '=', tenantId),
          eb('tenant_memberships.status', '=', 'active'),
          eb('users.suspended', '=', false),
          eb('users.deleted', '=', false),
          eb.or([
            eb('context.id', '=', tctx.id),
            eb('context.path', 'like', `${tctx.path}/%`),
          ]),
        ]))
        .execute();
      return rows.length;
    });
  }

  async assertTenantSlotForNewTeacher(tenantId: string, userId: string): Promise<void> {
    const kind = await this.tenantKind(tenantId);
    if (kind === null || kind === 'platform') return;
    const facts = await this.describeUserInTenant(tenantId, userId);
    if (facts.counted) return;
    const [{ limit }, used] = await Promise.all([
      this.effectiveTenantLimit(tenantId),
      this.countTenantTeachingSlots(tenantId),
    ]);
    if (used >= limit) {
      throw new SharedDomainError(
        'plan.tenant_slot_limit_reached',
        `Teaching-account slot limit reached for this centre: ${used}/${limit} slots in use`,
      );
    }
  }

  async assertUserReactivationWithinSlotLimits(userId: string): Promise<void> {
    const memberships = await this.runInPlatformScope(async () => {
      const rows = await this.db
        .selectFrom('tenant_memberships')
        .select('tenant_memberships.tenant_id as tenantId')
        .where((eb) => eb.and([
          eb('tenant_memberships.user_id', '=', userId),
          eb('tenant_memberships.status', '=', 'active'),
        ]))
        .execute();
      return rows;
    });
    for (const m of memberships) {
      if ((await this.tenantKind(m.tenantId)) === 'platform') continue;
      if (await this.userHoldsTeachingRoleInTenant(m.tenantId, userId)) {
        await this.assertTenantSlotForNewTeacher(m.tenantId, userId);
      }
    }
  }

  async isSiteAdmin(userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('role_assignments')
      .select('role_assignments.id')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('role.archetype', '=', 'manager'),
        eb('context.context_level', '=', CONTEXT_LEVELS.SYSTEM),
      ]))
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  async countTeacherOwnedCourses(userId: string): Promise<number> {
    const platformTenantId = await this.platformTenantId();
    if (!platformTenantId) return 0;
    const owned = new Set<string>();
    const byClass = await this.db
      .selectFrom('course')
      .select('course.id')
      .innerJoin('classes', 'classes.id', 'course.class_id')
      .where((eb) => eb.and([
        eb('classes.owner_id', '=', userId),
        eb('course.tenant_id', '=', platformTenantId),
        eb('course.is_template', '=', false),
      ]))
      .execute();
    for (const r of byClass) owned.add(r.id);
    const byGrant = await this.db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .innerJoin('course', 'course.id', 'context.instance_id')
      .select('context.instance_id as courseId')
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('role.archetype', 'in', [...TEACHING_ROLE_ARCHETYPES]),
        eb('context.context_level', '=', CONTEXT_LEVELS.COURSE),
        eb('role_assignments.component', '<>', 'enrol'),
        eb('course.tenant_id', '=', platformTenantId),
        eb('course.is_template', '=', false),
      ]))
      .execute();
    for (const r of byGrant) if (r.courseId) owned.add(r.courseId);
    return owned.size;
  }

  async assertTeacherCourseSlotForNewCourse(tenantId: string, classId: string): Promise<void> {
    if ((await this.tenantKind(tenantId)) !== 'platform') return;
    const [cls] = await this.db
      .selectFrom('classes')
      .select('classes.owner_id as ownerId')
      .where('classes.id', '=', classId)
      .execute();
    if (!cls) return;
    if (await this.isSiteAdmin(cls.ownerId)) return;
    const [{ limit }, used] = await Promise.all([
      this.effectiveTeacherLimit(cls.ownerId),
      this.countTeacherOwnedCourses(cls.ownerId),
    ]);
    if (used >= limit) {
      throw new SharedDomainError(
        'plan.teacher_course_limit_reached',
        `Course slot limit reached for this teacher: ${used}/${limit} owned courses in use`,
      );
    }
  }
}

const CONTEXT_COLUMNS_FOR_TENANT_ID = [
  'id',
  'context_level as contextLevel',
  'instance_id as instanceId',
  'path',
] as const;
