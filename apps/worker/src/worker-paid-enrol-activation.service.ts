import { Injectable } from '@nestjs/common';
import {
  CohortMaterializationSurface,
  ENROL_ACTIVE,
  SharedDomainError,
  type EnrolInstanceRow,
} from '@giaokhoa/enrol';
import type { PaidEnrolActivationPort } from '@giaokhoa/payments';
import { tenantAls } from './db/tenant-als';
import { WorkerEnrolOutboxService } from './worker-enrol-outbox.service';
import { WorkerPaymentSpaceScope } from './worker-payment-space-scope.service';

const ENROL_COLUMNS = [
  'id',
  'course_id as courseId',
  'enrol',
  'name',
  'role_id as roleId',
  'status',
  'enrol_period as enrolPeriod',
  'time_start as timeStart',
  'time_end as timeEnd',
  'enrolment_key as enrolmentKey',
  'custom_int1 as customInt1',
  'custom_int2 as customInt2',
  'custom_text1 as customText1',
  'cost',
  'currency',
  'payment_account_id as paymentAccountId',
  'send_welcome_message as sendWelcomeMessage',
  'welcome_message as welcomeMessage',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

@Injectable()
export class WorkerPaidEnrolActivationService implements PaidEnrolActivationPort {
  private readonly materialization: CohortMaterializationSurface;

  constructor(
    enrolOutbox: WorkerEnrolOutboxService,
    private readonly spaceScope: WorkerPaymentSpaceScope,
  ) {
    this.materialization = new CohortMaterializationSurface({
      db: this.spaceScope.routedKysely,
      outbox: enrolOutbox,
      runInPlatformScope: (fn) =>
        tenantAls.run({ platform: true, spaceSlug: tenantAls.getStore()?.spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle }, fn),
    });
  }

  async activatePaidEnrol(itemId: string, userId: string, tenantId: string): Promise<void> {
    await this.spaceScope.runForTenant(tenantId, async () => {
      await tenantAls.run(
        { platform: true, spaceSlug: tenantAls.getStore()?.spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle },
        async () => {
          const instance: EnrolInstanceRow | undefined = await this.spaceScope.routedKysely
            .selectFrom('enrol')
            .select(ENROL_COLUMNS)
            .where('id', '=', itemId)
            .executeTakeFirst();
          if (!instance) {
            throw new SharedDomainError('enrol.instance_not_found', `Enrol instance ${itemId} not found`);
          }
          if (instance.enrol !== 'fee') {
            throw new SharedDomainError('enrol.not_fee', 'Instance is not a fee enrol instance');
          }
          const existing = await this.spaceScope.routedKysely
            .selectFrom('user_enrolments')
            .select('status')
            .where('enrol_id', '=', itemId)
            .where('user_id', '=', userId)
            .executeTakeFirst();
          if (existing && existing.status === ENROL_ACTIVE) return;
          await this.materialization.enrolUserInternal(instance, userId, userId);
        },
      );
    });
  }
}
