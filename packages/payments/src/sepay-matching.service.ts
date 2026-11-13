import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxWriterService } from './outbox-writer.service';
import { PaymentsRepository } from './payments.repository';
import { PlanEntitlementsService } from './plan-entitlements.service';
import {
  PAID_CLASS_ENROL_ACTIVATION_PORT,
  PAID_ENROL_ACTIVATION_PORT,
  PAYMENT_SETTLEMENT_PORT,
  type PaidClassEnrolActivationPort,
  type PaidEnrolActivationPort,
  type PaymentSettlementPort,
} from './sepay-matching-ports';

@Injectable()
export class SepayMatchingService {
  private readonly logger = new Logger(SepayMatchingService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly outbox: OutboxWriterService,
    @Inject(PAID_ENROL_ACTIVATION_PORT) private readonly enrol: PaidEnrolActivationPort,
    @Inject(PAID_CLASS_ENROL_ACTIVATION_PORT) private readonly classes: PaidClassEnrolActivationPort,
    private readonly plans: PlanEntitlementsService,
    @Inject(PAYMENT_SETTLEMENT_PORT) private readonly payments: PaymentSettlementPort,
  ) {}

  async sweep(limit = 20): Promise<number> {
    const staleBefore = new Date(Date.now() - 60_000);
    const pending = await this.repo.listPendingProviderEvents(limit, staleBefore);
    let processed = 0;
    for (const event of pending) {
      try {
        await this.processEvent(event.id);
        processed += 1;
      } catch (error) {
        this.logger.warn(`Matching sự kiện SePay ${event.id} lỗi: ${(error as Error).message}`);
      }
    }
    return processed;
  }

  async processEvent(eventId: string): Promise<void> {
    if (!(await this.repo.claimProviderEvent(eventId))) return;
    const event = await this.repo.getProviderEvent(eventId);
    if (!event) return;
    if (event.direction === 'debit') {
      await this.payments.settleRefundFromDebitEvent(event);
      return;
    }
    const raw = (event.raw ?? {}) as Record<string, unknown>;
    const referenceCode = String(raw.reference_code ?? raw.referenceCode ?? event.externalTransactionId);
    const payment = event.extractedCode ? await this.repo.getPaymentByCode(event.extractedCode) : undefined;

    if (payment && payment.status === 'succeeded' && payment.externalTransactionId === referenceCode) {
      await this.repo.updateProviderEvent(event.id, { matchStatus: 'matched', matchedPaymentId: payment.id });
      return;
    }

    const accountMatches = !!payment && !!event.accountId && payment.accountId === event.accountId;
    const amountMatches = !!payment && payment.amount === event.amount;
    const stillPending = !!payment && payment.status === 'pending';
    const notExpired = !!payment && !(payment.expiresAt && payment.expiresAt.getTime() <= Date.now());

    const targetVerified = payment && accountMatches && amountMatches && stillPending && notExpired
      ? await this.payments.verifyPaymentAgainstServerTarget(payment)
      : false;

    if (payment && accountMatches && amountMatches && stillPending && notExpired && targetVerified) {
      if (payment.component === 'enrol_fee' && payment.itemId) {
        await this.enrol.activatePaidEnrol(payment.itemId, payment.userId, payment.tenantId);
      }
      if (payment.component === 'class_fee' && payment.itemId) {
        await this.classes.activatePaidClassEnrol(payment.itemId, payment.userId, payment.tenantId);
      }
      if (payment.component === 'tenant_plan' || payment.component === 'teacher_plan') {
        await this.plans.activateForPayment(payment);
      }
      await this.repo.updatePayment(payment.id, { status: 'succeeded', externalTransactionId: referenceCode });
      const succeeded = await this.repo.getPayment(payment.id);
      await this.outbox.enqueueStandalone({
        aggregate: 'payment', type: 'payment_succeeded',
        payload: {
          paymentId: succeeded!.id, userId: succeeded!.userId, amount: succeeded!.amount, currency: succeeded!.currency,
          component: succeeded!.component, itemId: succeeded!.itemId, externalTransactionId: referenceCode,
        },
      });
      await this.repo.updateProviderEvent(event.id, { matchStatus: 'matched', matchedPaymentId: payment.id });
      return;
    }

    if (payment && payment.status === 'pending') {
      await this.repo.updatePayment(payment.id, { status: 'needs_review' });
    }
    await this.repo.updateProviderEvent(event.id, {
      matchStatus: 'needs_review',
      matchedPaymentId: payment?.id ?? null,
    });
  }
}
