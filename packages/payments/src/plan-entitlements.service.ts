import { Injectable } from '@nestjs/common';
import { PaymentsRepository, type EntitlementRow, type PaymentRow } from './payments.repository';
import type { DbTx } from './database';

export interface PlanSnapshot {
  component: 'tenant_plan' | 'teacher_plan';
  configuredPrice: number;
  periodDays: number;
  beneficiaryTenantId: string;
  beneficiaryUserId: string | null;
  couponId?: string;
  couponCode?: string;
  discountAmount?: number;
}

export function planSnapshotOf(payment: PaymentRow): PlanSnapshot | null {
  const data = payment.data as { plan?: Partial<PlanSnapshot> } | null;
  const plan = data?.plan;
  if (!plan || (plan.component !== 'tenant_plan' && plan.component !== 'teacher_plan')) return null;
  if (typeof plan.periodDays !== 'number' || !Number.isInteger(plan.periodDays) || plan.periodDays <= 0) return null;
  if (typeof plan.beneficiaryTenantId !== 'string' || plan.beneficiaryTenantId.length === 0) return null;
  return {
    component: plan.component,
    configuredPrice:
      typeof plan.configuredPrice === 'number' && Number.isInteger(plan.configuredPrice)
        ? plan.configuredPrice
        : payment.amount,
    periodDays: plan.periodDays,
    beneficiaryTenantId: plan.beneficiaryTenantId,
    beneficiaryUserId: typeof plan.beneficiaryUserId === 'string' ? plan.beneficiaryUserId : null,
    couponId: typeof plan.couponId === 'string' ? plan.couponId : undefined,
    couponCode: typeof plan.couponCode === 'string' ? plan.couponCode : undefined,
    discountAmount:
      typeof plan.discountAmount === 'number' && Number.isInteger(plan.discountAmount) && plan.discountAmount >= 0
        ? plan.discountAmount
        : undefined,
  };
}

export function planChargedAmountOf(payment: PaymentRow): number | null {
  const data = payment.data as { plan?: Partial<PlanSnapshot> } | null;
  const plan = data?.plan;
  if (!plan || (plan.component !== 'tenant_plan' && plan.component !== 'teacher_plan')) return null;
  if (plan.component !== payment.component) return null;
  if (typeof plan.configuredPrice !== 'number' || !Number.isInteger(plan.configuredPrice) || plan.configuredPrice <= 0) return null;
  const discount = plan.discountAmount === undefined ? 0 : plan.discountAmount;
  if (typeof discount !== 'number' || !Number.isInteger(discount) || discount < 0 || discount >= plan.configuredPrice) return null;
  return plan.configuredPrice - discount;
}

@Injectable()
export class PlanEntitlementsService {
  constructor(private readonly repo: PaymentsRepository) {}

  async activateForPayment(payment: PaymentRow): Promise<EntitlementRow | null> {
    if (payment.component !== 'tenant_plan' && payment.component !== 'teacher_plan') return null;
    const snapshot = planSnapshotOf(payment);
    if (!snapshot) return null;
    const existing = await this.repo.getEntitlementByPayment(payment.id);
    if (existing) return existing;
    const now = new Date();
    const currentMax = await this.repo.maxActiveEntitlementExpiry(
      snapshot.component,
      snapshot.beneficiaryTenantId,
      snapshot.beneficiaryUserId,
    );
    const startsAt = currentMax && currentMax.getTime() > now.getTime() ? currentMax : now;
    const expiresAt = new Date(startsAt.getTime() + snapshot.periodDays * 86_400_000);
    try {
      return await this.repo.insertEntitlement({
        tenantId: snapshot.beneficiaryTenantId,
        userId: snapshot.beneficiaryUserId,
        component: snapshot.component,
        paymentId: payment.id,
        startsAt,
        expiresAt,
        status: 'active',
      });
    } catch (error) {
      const winner = await this.repo.getEntitlementByPayment(payment.id);
      if (winner) return winner;
      throw error;
    }
  }

  async suspendForPayment(payment: PaymentRow, tx?: DbTx): Promise<void> {
    if (payment.component !== 'tenant_plan' && payment.component !== 'teacher_plan') return;
    await this.repo.suspendEntitlementsByPayment(payment.id, tx);
  }
}
