import { Injectable } from '@nestjs/common';
import { RoleSeparationCore, type RoleConflictAuditReport } from '@giaokhoa/enrol';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls } from '../tenants/tenant-als';
import { delegateToSharedCore } from './translate-shared-error';

export { isRoleContextConflictError, ROLE_CONTEXT_CONFLICT_CODE } from '@giaokhoa/enrol';
export type { RoleConflictAuditEntry, RoleConflictAuditReport } from '@giaokhoa/enrol';

@Injectable()
export class RoleSeparationService {
  private readonly core: RoleSeparationCore;

  constructor(spaceDb: SpaceDatabaseService) {
    this.core = new RoleSeparationCore(spaceDb.routedKysely, (fn) => {
      const spaceSlug = tenantAls.getStore()?.spaceSlug;
      return tenantAls.run({ platform: true, ...(spaceSlug ? { spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) }, fn);
    });
  }

  async hasTeachingCoverageForCourse(userId: string, courseId: string): Promise<boolean> {
    return delegateToSharedCore(() => this.core.hasTeachingCoverageForCourse(userId, courseId));
  }

  async hasActiveLearnerEnrolment(userId: string, courseId: string): Promise<boolean> {
    return delegateToSharedCore(() => this.core.hasActiveLearnerEnrolment(userId, courseId));
  }

  async isLearnerGrantRole(roleId: string | null): Promise<boolean> {
    return delegateToSharedCore(() => this.core.isLearnerGrantRole(roleId));
  }

  async assertLearnerEnrolmentAllowed(userId: string, courseId: string): Promise<void> {
    return delegateToSharedCore(() => this.core.assertLearnerEnrolmentAllowed(userId, courseId));
  }

  async coursesFedByCohort(cohortId: string): Promise<string[]> {
    return delegateToSharedCore(() => this.core.coursesFedByCohort(cohortId));
  }

  async assertCohortMembershipAllowed(userId: string, cohortId: string): Promise<void> {
    return delegateToSharedCore(() => this.core.assertCohortMembershipAllowed(userId, cohortId));
  }

  async coveredCoursesForContext(contextId: string): Promise<string[]> {
    return delegateToSharedCore(() => this.core.coveredCoursesForContext(contextId));
  }

  async assertTeachingAssignmentAllowed(userId: string, contextId: string): Promise<void> {
    return delegateToSharedCore(() => this.core.assertTeachingAssignmentAllowed(userId, contextId));
  }

  async auditRoleConflicts(): Promise<RoleConflictAuditReport> {
    return delegateToSharedCore(() => this.core.auditRoleConflicts());
  }
}
