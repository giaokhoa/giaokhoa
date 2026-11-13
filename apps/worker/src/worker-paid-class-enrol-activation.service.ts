import { Injectable } from '@nestjs/common';
import {
  CohortMaterializationSurface,
  ensureActiveTenantMembership,
  SharedDomainError,
} from '@giaokhoa/enrol';
import type { PaidClassEnrolActivationPort } from '@giaokhoa/payments';
import { tenantAls } from './db/tenant-als';
import { WorkerEnrolOutboxService } from './worker-enrol-outbox.service';
import { WorkerPaymentSpaceScope } from './worker-payment-space-scope.service';

@Injectable()
export class WorkerPaidClassEnrolActivationService implements PaidClassEnrolActivationPort {
  private readonly materialization: CohortMaterializationSurface;

  constructor(
    private readonly enrolOutbox: WorkerEnrolOutboxService,
    private readonly spaceScope: WorkerPaymentSpaceScope,
  ) {
    this.materialization = new CohortMaterializationSurface({
      db: this.spaceScope.routedKysely,
      outbox: enrolOutbox,
      runInPlatformScope: (fn) =>
        tenantAls.run({ platform: true, spaceSlug: tenantAls.getStore()?.spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle }, fn),
    });
  }

  async activatePaidClassEnrol(itemId: string, userId: string, tenantId: string): Promise<void> {
    await this.spaceScope.runForTenant(tenantId, async () => {
      await tenantAls.run(
        { platform: true, spaceSlug: tenantAls.getStore()?.spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle },
        async () => {
          const row = await this.spaceScope.routedKysely
            .selectFrom('classes')
            .select(['id', 'status', 'cohort_id as cohortId', 'tenant_id as tenantId'])
            .where('id', '=', itemId)
            .executeTakeFirst();
          if (!row) {
            throw new SharedDomainError('class.not_found', `Class ${itemId} not found`);
          }
          if (row.status === 'archived') {
            throw new SharedDomainError('class.archived', 'Class is archived; roster is frozen');
          }
          if (await this.materialization.isCohortMember(row.cohortId, userId)) return;
          await ensureActiveTenantMembership(this.spaceScope.routedKysely, row.tenantId, userId);
          await this.materialization.roleSeparationChecks.assertCohortMembershipAllowed(userId, row.cohortId);
          await this.spaceScope.routedKysely.transaction().execute(async (tx) => {
            const inserted = await tx
              .insertInto('cohort_members')
              .values({ cohort_id: row.cohortId, user_id: userId })
              .onConflict((oc) => oc.doNothing())
              .returningAll()
              .execute();
            if (inserted.length === 0) return;
            await this.enrolOutbox.enqueue(tx, {
              aggregate: 'cohort', type: 'cohort_member_added',
              payload: { cohortId: row.cohortId, userId },
            });
            await this.enrolOutbox.enqueue(tx, {
              aggregate: 'class', type: 'class_member_joined',
              payload: { classId: row.id, tenantId: row.tenantId, userId, via: 'class_fee' },
              tenantId: row.tenantId,
            });
          });
        },
      );
    });
  }
}
