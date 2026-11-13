import type { PaymentRow, ProviderEventRow } from './payments.repository';


export const PAID_ENROL_ACTIVATION_PORT = Symbol('PAID_ENROL_ACTIVATION_PORT');

export const PAID_CLASS_ENROL_ACTIVATION_PORT = Symbol('PAID_CLASS_ENROL_ACTIVATION_PORT');

export const PAYMENT_SETTLEMENT_PORT = Symbol('PAYMENT_SETTLEMENT_PORT');

export interface PaidEnrolActivationPort {
  activatePaidEnrol(itemId: string, userId: string, tenantId: string): Promise<void>;
}

export interface PaidClassEnrolActivationPort {
  activatePaidClassEnrol(itemId: string, userId: string, tenantId: string): Promise<void>;
}

export interface PaymentSettlementPort {
  verifyPaymentAgainstServerTarget(payment: PaymentRow): Promise<boolean>;

  settleRefundFromDebitEvent(event: ProviderEventRow): Promise<void>;
}
