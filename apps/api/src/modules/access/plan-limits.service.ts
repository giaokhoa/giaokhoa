import { Injectable } from '@nestjs/common';
import { type CentreTx } from '@giaokhoa/db';
import { PlanLimitsCore, type EffectivePlanLimit, type TenantSlotFacts } from '@giaokhoa/enrol';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls } from '../tenants/tenant-als';
import { delegateToSharedCore } from './translate-shared-error';

export { TEACHING_ROLE_ARCHETYPES } from '@giaokhoa/enrol';
export type { EffectivePlanLimit, TenantSlotFacts } from '@giaokhoa/enrol';

@Injectable()
export class PlanLimitsService {
  private readonly core: PlanLimitsCore;

  constructor(spaceDb: SpaceDatabaseService) {
    this.core = new PlanLimitsCore(spaceDb.routedKysely, (fn) => {
      const spaceSlug = tenantAls.getStore()?.spaceSlug;
      return tenantAls.run({ platform: true, ...(spaceSlug ? { spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) }, fn);
    });
  }

  async tenantIdForContext(contextId: string, tx?: CentreTx): Promise<string | null> {
    return delegateToSharedCore(() => this.core.tenantIdForContext(contextId, tx));
  }

  async effectiveTenantLimit(tenantId: string): Promise<EffectivePlanLimit> {
    return delegateToSharedCore(() => this.core.effectiveTenantLimit(tenantId));
  }

  async effectiveTeacherLimit(userId: string): Promise<EffectivePlanLimit> {
    return delegateToSharedCore(() => this.core.effectiveTeacherLimit(userId));
  }

  async describeUserInTenant(tenantId: string, userId: string): Promise<TenantSlotFacts> {
    return delegateToSharedCore(() => this.core.describeUserInTenant(tenantId, userId));
  }

  async userHoldsTeachingRoleInTenant(tenantId: string, userId: string): Promise<boolean> {
    return delegateToSharedCore(() => this.core.userHoldsTeachingRoleInTenant(tenantId, userId));
  }

  async countTenantTeachingSlots(tenantId: string): Promise<number> {
    return delegateToSharedCore(() => this.core.countTenantTeachingSlots(tenantId));
  }

  async assertTenantSlotForNewTeacher(tenantId: string, userId: string): Promise<void> {
    return delegateToSharedCore(() => this.core.assertTenantSlotForNewTeacher(tenantId, userId));
  }

  async assertUserReactivationWithinSlotLimits(userId: string): Promise<void> {
    return delegateToSharedCore(() => this.core.assertUserReactivationWithinSlotLimits(userId));
  }

  async isSiteAdmin(userId: string): Promise<boolean> {
    return delegateToSharedCore(() => this.core.isSiteAdmin(userId));
  }

  async countTeacherOwnedCourses(userId: string): Promise<number> {
    return delegateToSharedCore(() => this.core.countTeacherOwnedCourses(userId));
  }

  async assertTeacherCourseSlotForNewCourse(tenantId: string, classId: string): Promise<void> {
    return delegateToSharedCore(() => this.core.assertTeacherCourseSlotForNewCourse(tenantId, classId));
  }
}
