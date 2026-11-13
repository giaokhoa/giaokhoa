import { Injectable } from '@nestjs/common';
import { sql, type CentreTx } from '@giaokhoa/db';
import {
  ENROL_SUSPENDED,
  ENROL_WITHDRAWN,
  SharedDomainError,
} from '@giaokhoa/enrol';
import {
  PaymentsRepository,
  planChargedAmountOf,
  type PaymentRow,
  type ProviderEventRow,
  type RefundRow,
} from '@giaokhoa/payments';
import type { PaymentSettlementPort } from '@giaokhoa/payments';
import { tenantAls } from './db/tenant-als';
import { WorkerEnrolOutboxService } from './worker-enrol-outbox.service';
import { WorkerPaymentSpaceScope } from './worker-payment-space-scope.service';

const PLATFORM_TENANT_SLUG = 'trang-chinh';

@Injectable()
export class WorkerPaymentSettlementService implements PaymentSettlementPort {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly enrolOutbox: WorkerEnrolOutboxService,
    private readonly spaceScope: WorkerPaymentSpaceScope,
  ) {}

  private async platformTenantId(): Promise<string> {
    const zero = await this.spaceScope.routedKysely
      .selectFrom('tenants')
      .select('id')
      .where('slug', '=', PLATFORM_TENANT_SLUG)
      .executeTakeFirst();
    if (!zero) {
      throw new SharedDomainError('tenant.platform_missing', 'Platform tenant (tenant-zero) is not seeded');
    }
    return zero.id;
  }

  async verifyPaymentAgainstServerTarget(payment: PaymentRow): Promise<boolean> {
    if (payment.component === 'enrol_fee' || payment.component === 'class_fee') {
      return this.spaceScope.runForTenant(payment.tenantId, () =>
        this.verifyTargetInCurrentScope(payment),
      );
    }
    return tenantAls.run({ platform: true }, () => this.verifyTargetInCurrentScope(payment));
  }

  private async verifyTargetInCurrentScope(payment: PaymentRow): Promise<boolean> {
    switch (payment.component) {
      case 'enrol_fee': {
        if (!payment.itemId) return false;
        const instance = await this.spaceScope.routedKysely
          .selectFrom('enrol')
          .select(['enrol', 'cost', 'course_id as courseId'])
          .where('id', '=', payment.itemId)
          .executeTakeFirst();
        if (!instance) return false;
        if (instance.enrol !== 'fee' || !instance.cost || instance.cost <= 0) return false;
        const courseRow = await this.spaceScope.routedKysely
          .selectFrom('course')
          .select('tenant_id as tenantId')
          .where('id', '=', instance.courseId)
          .executeTakeFirst();
        if (!courseRow?.tenantId) return false;
        return payment.amount === instance.cost && payment.tenantId === courseRow.tenantId;
      }
      case 'class_fee': {
        if (!payment.itemId) return false;
        const target = await this.spaceScope.routedKysely
          .selectFrom('classes')
          .select(['fee_cost as feeCost', 'tenant_id as tenantId'])
          .where('id', '=', payment.itemId)
          .executeTakeFirst();
        if (!target || !target.feeCost || target.feeCost <= 0) return false;
        return payment.amount === target.feeCost && payment.tenantId === target.tenantId;
      }
      case 'tenant_plan':
      case 'teacher_plan': {
        const expectedAmount = planChargedAmountOf(payment);
        if (expectedAmount === null) return false;
        return payment.amount === expectedAmount && payment.tenantId === (await this.platformTenantId());
      }
      default:
        return true;
    }
  }

  async settleRefundFromDebitEvent(event: ProviderEventRow): Promise<void> {
    await tenantAls.run({ platform: true }, async () => {
      const already = await this.repo.getRefundBySettledEventId(event.id);
      if (already) {
        await this.repo.updateProviderEvent(event.id, { matchStatus: 'matched', matchedPaymentId: already.paymentId });
        return;
      }
      if (!event.accountId) {
        await this.repo.updateProviderEvent(event.id, { matchStatus: 'needs_review' });
        return;
      }
      const raw = (event.raw ?? {}) as Record<string, unknown>;
      const referenceCode = typeof raw['reference_code'] === 'string'
        ? raw['reference_code']
        : typeof raw['referenceCode'] === 'string' ? raw['referenceCode'] : '';
      const candidate = await this.repo.findRefundCandidateForDebit({
        accountId: event.accountId, amount: event.amount,
        transactionIds: [event.externalTransactionId, referenceCode],
      });
      if (!candidate) {
        await this.repo.updateProviderEvent(event.id, { matchStatus: 'needs_review' });
        return;
      }
      try {
        await this.applyRefundSettlement({
          payment: candidate.payment, refund: candidate.refund,
          externalTransactionId: candidate.refund.externalTransactionId ?? event.externalTransactionId,
          settledBy: null, settledEventId: event.id,
          suspensionActorId: candidate.refund.createdBy ?? candidate.payment.userId,
        });
        await this.repo.updateProviderEvent(event.id, { matchStatus: 'matched', matchedPaymentId: candidate.payment.id });
      } catch {
        await this.repo.updateProviderEvent(event.id, { matchStatus: 'needs_review' });
      }
    });
  }

  private async suspendEntitlementForFullRefund(
    actorId: string,
    payment: PaymentRow,
    tx: CentreTx,
  ): Promise<void> {
    if (payment.component === 'enrol_fee' && payment.itemId) {
      await this.suspendEnrolment(actorId, payment.itemId, payment.userId, tx);
    }
    if (payment.component === 'class_fee' && payment.itemId) {
      await this.suspendPaidClassMember(payment.itemId, payment.userId, tx);
      return;
    }
    if (payment.component === 'tenant_plan' || payment.component === 'teacher_plan') {
      await this.repo.suspendEntitlementsByPayment(payment.id, tx);
    }
  }

  private async suspendEnrolment(
    actorId: string,
    instanceId: string,
    userId: string,
    tx: CentreTx,
  ): Promise<void> {
    const instance = await this.spaceScope.routedKysely
      .selectFrom('enrol')
      .select('course_id as courseId')
      .where('id', '=', instanceId)
      .executeTakeFirst();
    if (!instance) {
      throw new SharedDomainError('enrol.instance_not_found', `Enrol instance ${instanceId} not found`);
    }
    const ue = await this.spaceScope.routedKysely
      .selectFrom('user_enrolments')
      .select(['id', 'status'])
      .where('enrol_id', '=', instanceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!ue || ue.status === ENROL_WITHDRAWN) {
      throw new SharedDomainError('enrol.user_not_enrolled', 'User enrolment not found');
    }
    await tx.updateTable('user_enrolments')
      .set({ status: ENROL_SUSPENDED, modifier_id: actorId, updated_at: new Date() })
      .where('id', '=', ue.id)
      .execute();
    await this.enrolOutbox.enqueue(tx, {
      aggregate: 'enrol', type: 'user_enrolment_suspended',
      payload: { courseId: instance.courseId, userId, instanceId, actorId },
    });
  }

  private async suspendPaidClassMember(
    classId: string,
    userId: string,
    tx: CentreTx,
  ): Promise<void> {
    const row = await this.spaceScope.routedKysely
      .selectFrom('classes')
      .select('cohort_id as cohortId')
      .where('id', '=', classId)
      .executeTakeFirst();
    if (!row) return;
    const deleted = await tx.deleteFrom('cohort_members')
      .where('cohort_id', '=', row.cohortId)
      .where('user_id', '=', userId)
      .returningAll()
      .execute();
    if (deleted.length === 0) return;
    await this.enrolOutbox.enqueue(tx, {
      aggregate: 'cohort', type: 'cohort_member_removed',
      payload: { cohortId: row.cohortId, userId },
    });
  }

  private async applyRefundSettlement(input: {
    payment: PaymentRow; refund: RefundRow; externalTransactionId: string;
    settledBy: string | null; settledEventId: string | null; suspensionActorId: string;
  }): Promise<RefundRow> {
    const { payment, refund } = input;
    const now = new Date();
    return this.repo.transaction(async (tx) => {
      await sql`select id from payments where id = ${payment.id} for update`.execute(tx);
      const fresh = await this.repo.getRefund(refund.id, tx);
      if (!fresh || fresh.status === 'settled') return fresh ?? refund;
      if (fresh.status !== 'approved') {
        throw new SharedDomainError('payment.refund_not_approved', 'Refund is not approved for settlement');
      }
      const settledSum = await this.repo.sumRefundsByStatuses(payment.id, ['settled'], tx);
      const full = settledSum + fresh.amount === payment.amount;
      if (full) {
        await this.suspendEntitlementForFullRefund(input.suspensionActorId, payment, tx);
      }
      const data = { ...((fresh.data ?? {}) as Record<string, unknown>), reversal: { applied: full, at: now.toISOString() } };
      const updated = await this.repo.updateRefund(fresh.id, {
        status: 'settled', settledAt: now,
        settledBy: input.settledBy, settledEventId: input.settledEventId,
        externalTransactionId: input.externalTransactionId, data,
      }, tx);
      if (full) await this.repo.updatePayment(payment.id, { status: 'refunded' }, tx);
      return updated;
    });
  }
}
