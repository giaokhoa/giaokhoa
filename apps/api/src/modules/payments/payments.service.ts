import { Inject, Injectable, Logger } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../common/http-errors';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { sql, type CentreTx } from '@giaokhoa/db';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { ClassesService } from '../classes/classes.service';
import { EnrolService } from '../enrol/enrol.service';
import { SiteConfigService } from '../site-config/site-config.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantConfigService } from '../tenants/tenant-config.service';
import { TenantsService } from '../tenants/tenants.service';
import { PaymentsRepository, PlanEntitlementsService, planChargedAmountOf, type AccountRow, type CouponRow, type EntitlementRow, type PaymentRow, type PlanSnapshot, type ProviderEventRow, type RefundRow } from '@giaokhoa/payments';
import { buildVietQrPayload, extractPaymentCode, maskAccountConfig, paymentCodeFromSequence, readAccountConfig, PAYMENT_CODE_TTL_MS } from './vietqr';
import type { Coupon, CreateCoupon, CreateRefund, PaymentRefund, PaymentReviewQueueItem, PlanEntitlement, RejectRefund, ResolvePaymentReview, SettleRefund, UpdateCoupon } from '@giaokhoa/contracts';

export const PAYMENT_WEBHOOK_SECRET_HEADER = 'x-payment-webhook-secret';

export interface PaymentWebhookVerificationInput {
  externalTransactionId: string;
  paymentId: string;
  status: string;
  headers: Record<string, string | string[] | undefined>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
export interface PaymentGateway {
  name: string;
  verify(input: PaymentWebhookVerificationInput): Promise<boolean>;
}

@Injectable()
export class ManualPaymentGateway implements PaymentGateway {
  name = 'manual';
  constructor(private readonly config: ConfigService) {}
  async verify(input: PaymentWebhookVerificationInput): Promise<boolean> {
    if (input.externalTransactionId.length === 0) return false;
    const expected = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!expected) return false;
    const raw = input.headers[PAYMENT_WEBHOOK_SECRET_HEADER];
    const given = Array.isArray(raw) ? raw[0] : raw;
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export type PaymentView = PaymentRow & { vietqrPayload: string | null };
export type AccountView = Omit<AccountRow, 'config'> & { config: Record<string, unknown> | null };

export interface SepayIpnInput {
  ip?: string;
  authorization?: string;
  body: unknown;
}

export const ENTITLEMENT_COMPONENTS = ['enrol_fee', 'class_fee', 'tenant_plan', 'teacher_plan'] as const;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly outbox: OutboxService,
    private readonly enrol: EnrolService,
    private readonly classes: ClassesService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly tenantContext: TenantContextService,
    private readonly tenants: TenantsService,
    private readonly tenantConfig: TenantConfigService,
    private readonly siteConfig: SiteConfigService,
    private readonly plans: PlanEntitlementsService,
    private readonly config: ConfigService,
  ) {}

  private async platformTenantId(): Promise<string> {
    return (await this.tenants.platformTenant()).id;
  }

  private async requireManageAccountsForTenant(actorId: string, tenantId: string): Promise<void> {
    if (tenantId === (await this.platformTenantId())) {
      const sys = await this.contexts.ensureSystemContext();
      await this.evaluator.requireCapability(actorId, 'payment:manageaccounts', sys.id);
      return;
    }
    const ctx = await this.contexts.ensureTenantContext(tenantId);
    await this.evaluator.requireCapability(actorId, 'payment:manageaccounts', ctx.id);
  }

  private async requireManageAccounts(actorId: string): Promise<void> {
    await this.requireManageAccountsForTenant(actorId, await this.effectiveTenantId());
  }

  private async requireManageCoupons(actorId: string): Promise<void> {
    const sys = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'payment:managecoupons', sys.id);
  }

  private async effectiveTenantId(): Promise<string> {
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }
  private maskAccount(row: AccountRow): AccountView {
    return { ...row, config: row.config == null ? null : maskAccountConfig(row.config) };
  }

  private async getAccountForRead(id: string): Promise<AccountRow> {
    const row = await this.repo.getAccount(id);
    if (!row) notFound(`Payment account ${id} not found`, 'payment.account_not_found');
    const active = this.tenantContext.currentTenantId();
    if (active !== undefined && row.tenantId !== active) {
      notFound(`Payment account ${id} not found`, 'payment.account_not_found');
    }
    return row;
  }

  async createAccount(actorId: string, input: { name: string; gateway?: string; config?: Record<string, unknown> }): Promise<AccountView> {
    await this.requireManageAccounts(actorId);
    const tenantId = await this.effectiveTenantId();
    const row = await this.repo.insertAccount({
      name: input.name, gateway: input.gateway ?? 'manual', tenantId, config: input.config ?? null,
    });
    return this.maskAccount(row);
  }
  async listAccounts(actorId: string): Promise<AccountView[]> {
    await this.requireManageAccounts(actorId);
    const tenantId = await this.effectiveTenantId();
    const rows = await this.repo.listAccounts();
    return rows.filter((r) => r.tenantId === tenantId).map((r) => this.maskAccount(r));
  }
  async getAccount(id: string): Promise<AccountView> {
    return this.maskAccount(await this.getAccountForRead(id));
  }
  async getPayment(id: string): Promise<PaymentView> {
    const row = await this.repo.getPayment(id);
    if (!row) notFound(`Payment ${id} not found`, 'payment.not_found');
    return this.paymentView(row);
  }

  private async paymentView(row: PaymentRow): Promise<PaymentView> {
    let vietqrPayload: string | null = null;
    if (row.paymentCode && row.status === 'pending' && !(row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      const account = await this.repo.getAccount(row.accountId);
      if (account) vietqrPayload = buildVietQrPayload(account, row.amount, row.paymentCode);
    }
    return { ...row, vietqrPayload };
  }

  private async assertCanReadPayment(actorId: string, payment: PaymentRow): Promise<void> {
    if (payment.userId === actorId) return;
    const sys = await this.contexts.ensureSystemContext();
    if (await this.evaluator.hasCapability(actorId, 'payment:manageaccounts', sys.id)) return;
    notFound(`Payment ${payment.id} not found`, 'payment.not_found');
  }
  async getPaymentForUser(actorId: string, id: string): Promise<PaymentRow> {
    const row = await this.getPayment(id);
    await this.assertCanReadPayment(actorId, row);
    return row;
  }
  async listRefundsForUser(actorId: string, paymentId: string): Promise<PaymentRefund[]> {
    const payment = await this.getPayment(paymentId);
    await this.assertCanReadPayment(actorId, payment);
    const rows = await this.repo.listRefunds(paymentId);
    return rows.map((r) => this.toRefundView(r));
  }

  async createPayment(userId: string, input: { accountId: string; amount: number; currency: string; component?: string; itemId?: string }): Promise<PaymentView> {
    if (input.component !== undefined && (ENTITLEMENT_COMPONENTS as readonly string[]).includes(input.component)) {
      badRequest(`Component ${input.component} grants entitlements and can only be created through its dedicated server-priced purchase endpoint`, 'payment.entitlement_component_forbidden');
    }
    const active = this.tenantContext.currentTenantId();
    return this.createPaymentInTenant(userId, input, active);
  }

  private async createPaymentInTenant(
    userId: string,
    input: { accountId: string; amount: number; currency: string; component?: string; itemId?: string; data?: Record<string, unknown> },
    contextTenantId: string | undefined,
  ): Promise<PaymentView> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      badRequest('Amount must be a positive integer in the smallest currency unit', 'payment.amount_not_integer');
    }
    const account = await this.repo.getAccount(input.accountId);
    if (!account) notFound(`Payment account ${input.accountId} not found`, 'payment.account_not_found');
    if (!account.enabled) badRequest('Payment account is disabled', 'payment.account_disabled');
    if (contextTenantId !== undefined && account.tenantId !== contextTenantId) {
      badRequest('Payment account belongs to a different tenant', 'payment.account_tenant_mismatch');
    }
    let paymentCode: string | null = null;
    let expiresAt: Date | null = null;
    let vietqrPayload: string | null = null;
    if (account.gateway === 'sepay') {
      const code = paymentCodeFromSequence(await this.repo.nextPaymentCodeValue());
      const built = buildVietQrPayload(account, input.amount, code);
      if (built) {
        paymentCode = code;
        expiresAt = new Date(Date.now() + PAYMENT_CODE_TTL_MS);
        vietqrPayload = built;
      }
    }
    const row = await this.repo.insertPayment({
      accountId: input.accountId, tenantId: account.tenantId, userId: userId, amount: input.amount, currency: input.currency.toUpperCase(),
      status: 'pending', gateway: account.gateway, component: input.component ?? '', itemId: input.itemId ?? null,
      paymentCode, expiresAt, data: input.data ?? null,
    });
    return { ...row, vietqrPayload };
  }

  async verifyPaymentAgainstServerTarget(payment: PaymentRow): Promise<boolean> {
    switch (payment.component) {
      case 'enrol_fee': {
        if (!payment.itemId) return false;
        let instance: Awaited<ReturnType<EnrolService['getInstance']>>;
        try {
          instance = await this.enrol.getInstance(payment.itemId);
        } catch {
          return false;
        }
        if (instance.enrol !== 'fee' || !instance.cost || instance.cost <= 0) return false;
        const courseTenantId = await this.repo.getCourseTenantId(instance.courseId);
        if (!courseTenantId) return false;
        return payment.amount === instance.cost && payment.tenantId === courseTenantId;
      }
      case 'class_fee': {
        if (!payment.itemId) return false;
        const target = await this.classes.getClassFeeTarget(payment.itemId);
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

  async createFeePayment(userId: string, enrolInstanceId: string): Promise<PaymentView> {
    const instance = await this.enrol.getInstance(enrolInstanceId);
    if (instance.enrol !== 'fee' || !instance.cost || instance.cost <= 0) {
      badRequest('Enrol instance has no fee configured', 'payment.no_fee');
    }
    const courseTenantId = await this.repo.getCourseTenantId(instance.courseId);
    if (!courseTenantId) badRequest('Course not found for this fee enrol instance', 'payment.no_course');
    let accountId = instance.paymentAccountId ?? undefined;
    if (accountId) {
      const account = await this.repo.getAccount(accountId);
      if (!account) badRequest('Configured payment account no longer exists', 'payment.no_account');
      if (account.tenantId !== courseTenantId) {
        badRequest('Payment account belongs to a different tenant than the course', 'payment.account_tenant_mismatch');
      }
    } else {
      const own = (await this.repo.listAccounts()).filter((a) => a.tenantId === courseTenantId && a.enabled);
      accountId = own[0]?.id;
    }
    if (!accountId) badRequest('No payment account configured for this fee enrol instance', 'payment.no_account');
    return this.createPaymentInTenant(userId, { accountId, amount: instance.cost, currency: instance.currency || 'VND', component: 'enrol_fee', itemId: enrolInstanceId }, courseTenantId);
  }

  async createClassFeePayment(userId: string, classId: string): Promise<PaymentView> {
    const target = await this.classes.resolveClassFeePurchase(classId, userId);
    let accountId = target.feePaymentAccountId ?? undefined;
    if (accountId) {
      const account = await this.repo.getAccount(accountId);
      if (!account) badRequest('Configured payment account no longer exists', 'payment.no_account');
      if (account.tenantId !== target.tenantId) {
        badRequest('Payment account belongs to a different tenant than the class', 'payment.account_tenant_mismatch');
      }
    } else {
      const own = (await this.repo.listAccounts()).filter((a) => a.tenantId === target.tenantId && a.enabled);
      accountId = own[0]?.id;
    }
    if (!accountId) badRequest('No payment account configured for this class fee', 'payment.no_account');
    return this.createPaymentInTenant(userId, { accountId, amount: target.feeCost, currency: target.feeCurrency || 'VND', component: 'class_fee', itemId: target.classId }, target.tenantId);
  }


  private toCouponView(row: CouponRow): Coupon {
    return {
      id: row.id,
      code: row.code,
      discountType: row.discountType as Coupon['discountType'],
      discountValue: row.discountValue,
      appliesTo: row.appliesTo as Coupon['appliesTo'],
      startsAt: row.startsAt ? row.startsAt.toISOString() : null,
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      maxRedemptions: row.maxRedemptions,
      isActive: row.isActive,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private assertCouponFieldsValid(fields: {
    discountType: string; discountValue: number; startsAt: Date | null; endsAt: Date | null;
  }): void {
    if (fields.discountType === 'percent' && (fields.discountValue < 1 || fields.discountValue > 99)) {
      badRequest('Percent discount value must be between 1 and 99', 'payment.coupon_invalid');
    }
    if (fields.discountType === 'fixed' && (!Number.isInteger(fields.discountValue) || fields.discountValue < 1)) {
      badRequest('Fixed discount value must be a positive integer', 'payment.coupon_invalid');
    }
    if (fields.discountType !== 'percent' && fields.discountType !== 'fixed') {
      badRequest(`Unknown coupon discount type: ${fields.discountType}`, 'payment.coupon_invalid');
    }
    if (fields.startsAt && fields.endsAt && fields.startsAt.getTime() >= fields.endsAt.getTime()) {
      badRequest('Coupon endsAt must be after startsAt', 'payment.coupon_invalid');
    }
  }

  async createCoupon(actorId: string, input: CreateCoupon): Promise<Coupon> {
    await this.requireManageCoupons(actorId);
    const code = input.code.trim().toUpperCase();
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    this.assertCouponFieldsValid({ discountType: input.discountType, discountValue: input.discountValue, startsAt, endsAt });
    if (await this.repo.getCouponByCode(code)) {
      conflict(`Coupon code ${code} is already taken`, 'payment.coupon_code_taken');
    }
    const row = await this.repo.insertCoupon({
      code,
      discountType: input.discountType,
      discountValue: input.discountValue,
      appliesTo: input.appliesTo,
      startsAt,
      endsAt,
      maxRedemptions: input.maxRedemptions ?? null,
      isActive: input.isActive,
      createdBy: actorId,
    });
    return this.toCouponView(row);
  }

  async listCoupons(actorId: string): Promise<Coupon[]> {
    await this.requireManageCoupons(actorId);
    return (await this.repo.listCoupons()).map((r) => this.toCouponView(r));
  }

  async getCoupon(actorId: string, id: string): Promise<Coupon> {
    await this.requireManageCoupons(actorId);
    const row = await this.repo.getCoupon(id);
    if (!row) notFound(`Coupon ${id} not found`, 'payment.coupon_not_found');
    return this.toCouponView(row);
  }

  async updateCoupon(actorId: string, id: string, input: UpdateCoupon): Promise<Coupon> {
    await this.requireManageCoupons(actorId);
    const row = await this.repo.getCoupon(id);
    if (!row) notFound(`Coupon ${id} not found`, 'payment.coupon_not_found');
    const merged = {
      discountType: input.discountType ?? row.discountType,
      discountValue: input.discountValue ?? row.discountValue,
      startsAt: input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : row.startsAt,
      endsAt: input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : row.endsAt,
    };
    this.assertCouponFieldsValid(merged);
    const updated = await this.repo.updateCoupon(id, {
      discountType: merged.discountType,
      discountValue: merged.discountValue,
      appliesTo: input.appliesTo ?? row.appliesTo,
      startsAt: merged.startsAt,
      endsAt: merged.endsAt,
      maxRedemptions: input.maxRedemptions !== undefined ? input.maxRedemptions : row.maxRedemptions,
      isActive: input.isActive ?? row.isActive,
    });
    return this.toCouponView(updated);
  }

  private async resolveCouponDiscount(
    couponCode: string,
    component: 'tenant_plan' | 'teacher_plan',
    configuredPrice: number,
  ): Promise<{ coupon: CouponRow; discountAmount: number }> {
    const code = couponCode.trim().toUpperCase();
    const coupon = await this.repo.getCouponByCode(code);
    if (!coupon) {
      badRequest(`Coupon ${code} not found`, 'payment.coupon_not_found');
    }
    if (!coupon.isActive) {
      badRequest(`Coupon ${code} is not active`, 'payment.coupon_inactive');
    }
    const now = Date.now();
    if ((coupon.startsAt && now < coupon.startsAt.getTime()) || (coupon.endsAt && now >= coupon.endsAt.getTime())) {
      badRequest(`Coupon ${code} is outside its validity window`, 'payment.coupon_not_in_window');
    }
    if (coupon.appliesTo !== 'all' && coupon.appliesTo !== component) {
      badRequest(`Coupon ${code} does not apply to ${component}`, 'payment.coupon_not_applicable');
    }
    if (coupon.maxRedemptions !== null && (await this.repo.countCouponRedemptions(coupon.id)) >= coupon.maxRedemptions) {
      badRequest(`Coupon ${code} has no redemptions left`, 'payment.coupon_exhausted');
    }
    const discountAmount = coupon.discountType === 'percent'
      ? Math.floor((configuredPrice * coupon.discountValue) / 100)
      : coupon.discountValue;
    if (discountAmount < 1 || discountAmount >= configuredPrice) {
      badRequest(`Coupon ${code} discount must leave a payable amount of at least 1`, 'payment.coupon_exceeds_price');
    }
    return { coupon, discountAmount };
  }

  async createPlanPayment(userId: string, input: { component: string; couponCode?: string }): Promise<PaymentView> {
    if (input.component !== 'tenant_plan' && input.component !== 'teacher_plan') {
      badRequest(`Unknown plan component: ${input.component}`, 'payment.unknown_plan_component');
    }
    const component = input.component;
    const price = await this.siteConfig.getValue<number>('payments', component === 'tenant_plan' ? 'tenantplanprice' : 'teacherplanprice');
    const periodDays = await this.siteConfig.getValue<number>('payments', component === 'tenant_plan' ? 'tenantplanperioddays' : 'teacherplanperioddays');
    if (price === undefined || !Number.isInteger(price) || price <= 0 || periodDays === undefined || !Number.isInteger(periodDays) || periodDays <= 0) {
      badRequest('Plan price is not configured as a positive integer in system settings', 'payment.plan_not_configured');
    }
    const platformTenantId = await this.tenants.fallbackTenantId();
    const account = (await this.repo.listAccounts())
      .filter((a) => a.tenantId === platformTenantId && a.enabled)
      .sort((a, b) =>
        (a.gateway === 'sepay' ? 0 : 1) - (b.gateway === 'sepay' ? 0 : 1)
        || a.createdAt.getTime() - b.createdAt.getTime()
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
    if (!account) badRequest('No payment account configured for plan purchases', 'payment.no_account');
    const beneficiaryTenantId = await this.effectiveTenantId();
    let amount = price;
    let couponSnapshot: Pick<PlanSnapshot, 'couponId' | 'couponCode' | 'discountAmount'> = {};
    if (input.couponCode) {
      const resolved = await this.resolveCouponDiscount(input.couponCode, component, price);
      amount = price - resolved.discountAmount;
      couponSnapshot = {
        couponId: resolved.coupon.id,
        couponCode: resolved.coupon.code,
        discountAmount: resolved.discountAmount,
      };
    }
    const snapshot: PlanSnapshot = {
      component,
      configuredPrice: price,
      periodDays,
      beneficiaryTenantId,
      beneficiaryUserId: component === 'teacher_plan' ? userId : null,
      ...couponSnapshot,
    };
    return this.createPaymentInTenant(userId, {
      accountId: account.id, amount, currency: 'VND', component,
      itemId: component === 'tenant_plan' ? beneficiaryTenantId : userId,
      data: { plan: snapshot },
    }, platformTenantId);
  }

  async listMyPlanEntitlements(userId: string): Promise<PlanEntitlement[]> {
    const tenantId = await this.effectiveTenantId();
    const byId = new Map<string, EntitlementRow>();
    const rows = [
      ...(await this.repo.listEntitlementsForUser(userId)),
      ...(await this.repo.listTenantPlanEntitlements(tenantId)),
    ];
    for (const row of rows) byId.set(row.id, row);
    return [...byId.values()].map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      component: row.component as PlanEntitlement['component'],
      paymentId: row.paymentId,
      startsAt: row.startsAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      status: row.status as PlanEntitlement['status'],
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async handleWebhook(input: { gateway: string; externalTransactionId: string; paymentId: string; status: string }, headers: Record<string, string | string[] | undefined> = {}): Promise<{ status: string; duplicate?: boolean; payment: PaymentRow }> {
    if (input.gateway !== this.gateway.name) {
      badRequest(`Unknown payment gateway: ${input.gateway}`, 'payment.webhook_unknown_gateway');
    }
    const verified = await this.gateway.verify({ externalTransactionId: input.externalTransactionId, paymentId: input.paymentId, status: input.status, headers });
    if (!verified) {
      unauthorized('Payment webhook verification failed', 'payment.webhook_verification_failed');
    }
    const existing = await this.repo.getByExternalTx(input.gateway, input.externalTransactionId);
    if (existing) return { status: existing.status, duplicate: true, payment: existing };
    const payment = await this.getPayment(input.paymentId);
    if (payment.status === 'succeeded') return { status: 'succeeded', duplicate: true, payment };
    if (input.status !== 'succeeded') {
      await this.repo.updatePayment(payment.id, { status: 'failed', gateway: input.gateway, externalTransactionId: input.externalTransactionId });
      return { status: 'failed', payment: await this.getPayment(payment.id) };
    }
    if (!(await this.verifyPaymentAgainstServerTarget(payment))) {
      await this.repo.updatePayment(payment.id, { status: 'needs_review', gateway: input.gateway, externalTransactionId: input.externalTransactionId });
      return { status: 'needs_review', payment: await this.getPayment(payment.id) };
    }
    if (payment.component === 'enrol_fee' && payment.itemId) {
      await this.enrol.activatePaidEnrol(payment.itemId, payment.userId);
    }
    if (payment.component === 'class_fee' && payment.itemId) {
      await this.classes.activatePaidClassEnrol(payment.itemId, payment.userId);
    }
    if (payment.component === 'tenant_plan' || payment.component === 'teacher_plan') {
      await this.plans.activateForPayment(payment);
    }
    await this.repo.updatePayment(payment.id, { status: 'succeeded', gateway: input.gateway, externalTransactionId: input.externalTransactionId });
    const succeeded = await this.getPayment(payment.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'payment', type: 'payment_succeeded',
      payload: { paymentId: succeeded.id, userId: succeeded.userId, amount: succeeded.amount, currency: succeeded.currency, component: succeeded.component, itemId: succeeded.itemId, externalTransactionId: input.externalTransactionId },
    });
    return { status: 'succeeded', payment: succeeded };
  }


  async handleSepayIpn(input: SepayIpnInput): Promise<{ success: true; duplicate?: boolean }> {
    const body = (input.body && typeof input.body === 'object' ? input.body : {}) as Record<string, unknown>;
    const allowlist = (this.config.get<string>('SEPAY_IPN_IP_ALLOWLIST') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowlist.length > 0) {
      const ip = (input.ip ?? '').replace(/^::ffff:/, '');
      if (!allowlist.includes(ip)) {
        unauthorized('IPN source IP is not allowlisted', 'payment.ipn_ip_not_allowed');
      }
    }
    const transactionId = String(body.transaction_id ?? body.transactionId ?? body.id ?? '');
    if (!transactionId) {
      badRequest('IPN payload has no transaction id', 'payment.ipn_missing_transaction');
    }
    const amountRaw = Number(body.amount ?? body.transferAmount ?? body.transfer_amount);
    const amount = Number.isFinite(amountRaw) ? Math.trunc(amountRaw) : 0;
    const content = String(body.content ?? '');
    const transferType = String(body.transfer_type ?? body.transferType ?? '').toLowerCase();
    const direction = transferType === 'debit' || transferType === 'out' ? 'debit' : 'credit';
    const xid = String(body.bank_account_xid ?? body.bankAccountXid ?? '');
    const accountNumber = String(body.account_number ?? body.accountNumber ?? '');
    let account = xid ? await this.repo.findAccountBySepayXid(xid) : undefined;
    if (!account && accountNumber) account = await this.repo.findAccountByBankNumber(accountNumber);
    if (!account) {
      unauthorized('IPN targets an unknown payment account', 'payment.ipn_account_unknown');
    }
    const expectedKey = readAccountConfig(account.config).sepayApiKey;
    if (!expectedKey) {
      unauthorized('Payment account has no SePay API key configured', 'payment.ipn_not_configured');
    }
    const headerMatch = /^Apikey\s+(.+)$/i.exec((input.authorization ?? '').trim());
    const presented = headerMatch?.[1] ?? '';
    const presentedBuf = Buffer.from(presented);
    const expectedBuf = Buffer.from(expectedKey);
    if (!presented || presentedBuf.length !== expectedBuf.length || !timingSafeEqual(presentedBuf, expectedBuf)) {
      unauthorized('IPN API key verification failed', 'payment.ipn_unauthorized');
    }
    const event = await this.repo.insertProviderEvent({
      provider: 'sepay', tenantId: account.tenantId, accountId: account.id,
      externalTransactionId: transactionId, direction, amount, content,
      extractedCode: extractPaymentCode(content), matchStatus: 'received', raw: body,
    });
    if (!event) return { success: true, duplicate: true };
    return { success: true };
  }


  private toRefundView(row: RefundRow): PaymentRefund {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const reversal = (data['reversal'] ?? null) as { applied?: boolean } | null;
    return {
      id: row.id,
      paymentId: row.paymentId,
      amount: row.amount,
      currency: row.currency,
      reason: row.reason,
      externalTransactionId: row.externalTransactionId,
      status: row.status as PaymentRefund['status'],
      createdBy: row.createdBy,
      approvalLevel: row.approvalLevel,
      approvalThreshold: row.approvalThreshold,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      rejectedBy: row.rejectedBy,
      rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
      rejectionReason: row.rejectionReason,
      settledBy: row.settledBy,
      settledEventId: row.settledEventId,
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
      entitlementReversed: reversal ? reversal.applied === true : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async refundDualApprovalThreshold(tenantId: string): Promise<number> {
    const value = await this.tenantConfig.getEffectiveValue<number>(tenantId, 'payments', 'refunddualapprovalthreshold');
    return typeof value === 'number' && Number.isFinite(value) ? value : 1_000_000;
  }

  private async reviewTargetHours(tenantId: string): Promise<number> {
    const value = await this.tenantConfig.getEffectiveValue<number>(tenantId, 'payments', 'reviewtargethours');
    return typeof value === 'number' && Number.isFinite(value) ? value : 48;
  }

  async createRefund(actorId: string, paymentId: string, input: CreateRefund): Promise<PaymentRefund> {
    const payment = await this.getPayment(paymentId);
    await this.requireManageAccountsForTenant(actorId, payment.tenantId);
    if (payment.status !== 'succeeded') badRequest('Only a succeeded payment can be refunded', 'payment.not_succeeded');
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > payment.amount) {
      badRequest('Refund amount must be a positive integer not exceeding the payment amount', 'payment.bad_refund_amount');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      badRequest('A refund reason is required', 'payment.refund_reason_required');
    }
    const threshold = await this.refundDualApprovalThreshold(payment.tenantId);
    const created = await this.repo.transaction(async (tx) => {
      await sql`select id from payments where id = ${payment.id} for update`.execute(tx);
      const counted = await this.repo.sumRefundsByStatuses(payment.id, ['requested', 'approved', 'settled'], tx);
      if (counted + input.amount > payment.amount) {
        badRequest('Cumulative refunds would exceed the original payment amount', 'payment.refund_exceeds_total');
      }
      const dual = input.amount >= threshold || counted + input.amount === payment.amount;
      const now = new Date();
      return this.repo.insertRefund({
        paymentId: payment.id, amount: input.amount, currency: payment.currency,
        reason, externalTransactionId: input.externalTransactionId ?? null,
        status: dual ? 'requested' : 'approved',
        createdBy: actorId,
        approvalLevel: dual ? 2 : 1,
        approvalThreshold: threshold,
        approvedBy: dual ? null : actorId,
        approvedAt: dual ? null : now,
      }, tx);
    });
    return this.toRefundView(created);
  }

  private async getRefundOfPayment(paymentId: string, refundId: string): Promise<RefundRow> {
    const refund = await this.repo.getRefund(refundId);
    if (!refund || refund.paymentId !== paymentId) {
      notFound(`Refund ${refundId} not found`, 'payment.refund_not_found');
    }
    return refund;
  }

  async approveRefund(actorId: string, paymentId: string, refundId: string): Promise<PaymentRefund> {
    const payment = await this.getPayment(paymentId);
    await this.requireManageAccountsForTenant(actorId, payment.tenantId);
    const refund = await this.getRefundOfPayment(paymentId, refundId);
    if (refund.status !== 'requested') {
      badRequest('Refund is not pending approval', 'payment.refund_not_pending_approval');
    }
    if (refund.createdBy !== null && refund.createdBy === actorId) {
      badRequest('The second approver must differ from the refund creator', 'payment.refund_approver_must_differ');
    }
    const updated = await this.repo.updateRefundFromStatuses(refund.id, ['requested'], { status: 'approved', approvedBy: actorId, approvedAt: new Date() });
    if (!updated) {
      badRequest('Refund is not pending approval', 'payment.refund_not_pending_approval');
    }
    return this.toRefundView(updated);
  }

  async rejectRefund(actorId: string, paymentId: string, refundId: string, input: RejectRefund): Promise<PaymentRefund> {
    const payment = await this.getPayment(paymentId);
    await this.requireManageAccountsForTenant(actorId, payment.tenantId);
    const refund = await this.getRefundOfPayment(paymentId, refundId);
    if (refund.status !== 'requested' && refund.status !== 'approved') {
      badRequest('Refund can no longer be rejected', 'payment.refund_not_rejectable');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      badRequest('A rejection reason is required', 'payment.refund_rejection_reason_required');
    }
    const updated = await this.repo.updateRefundFromStatuses(refund.id, ['requested', 'approved'], {
      status: 'rejected', rejectedBy: actorId, rejectedAt: new Date(), rejectionReason: reason,
    });
    if (!updated) {
      badRequest('Refund can no longer be rejected', 'payment.refund_not_rejectable');
    }
    return this.toRefundView(updated);
  }

  private async suspendEntitlementForFullRefund(actorId: string, payment: PaymentRow, tx: CentreTx): Promise<{ cohortId: string; userId: string } | null> {
    if (payment.component === 'enrol_fee' && payment.itemId) {
      await this.enrol.setSuspended(actorId, payment.itemId, payment.userId, true, tx);
    }
    if (payment.component === 'class_fee' && payment.itemId) {
      const cohortId = await this.classes.suspendPaidClassMember(payment.itemId, payment.userId, tx);
      return cohortId ? { cohortId, userId: payment.userId } : null;
    }
    if (payment.component === 'tenant_plan' || payment.component === 'teacher_plan') {
      await this.plans.suspendForPayment(payment, tx);
    }
    return null;
  }

  private async applyRefundSettlement(input: {
    payment: PaymentRow; refund: RefundRow; externalTransactionId: string;
    settledBy: string | null; settledEventId: string | null; suspensionActorId: string;
  }): Promise<RefundRow> {
    const { payment, refund } = input;
    const now = new Date();
    const outcome = await this.repo.transaction(async (tx) => {
      await sql`select id from payments where id = ${payment.id} for update`.execute(tx);
      const fresh = await this.repo.getRefund(refund.id, tx);
      if (!fresh || fresh.status === 'settled') return { settled: fresh ?? refund, pendingRemoval: null };
      if (fresh.status !== 'approved') {
        badRequest('Refund is not approved for settlement', 'payment.refund_not_approved');
      }
      const settledSum = await this.repo.sumRefundsByStatuses(payment.id, ['settled'], tx);
      const full = settledSum + fresh.amount === payment.amount;
      let pendingRemoval: { cohortId: string; userId: string } | null = null;
      if (full) {
        pendingRemoval = await this.suspendEntitlementForFullRefund(input.suspensionActorId, payment, tx);
      }
      const data = { ...((fresh.data ?? {}) as Record<string, unknown>), reversal: { applied: full, at: now.toISOString() } };
      const updated = await this.repo.updateRefund(fresh.id, {
        status: 'settled', settledAt: now,
        settledBy: input.settledBy, settledEventId: input.settledEventId,
        externalTransactionId: input.externalTransactionId, data,
      }, tx);
      if (full) await this.repo.updatePayment(payment.id, { status: 'refunded' }, tx);
      return { settled: updated, pendingRemoval };
    });
    if (outcome.pendingRemoval) {
      try {
        await this.classes.notifyPaidClassMemberRemoved(outcome.pendingRemoval.cohortId, outcome.pendingRemoval.userId);
      } catch (error) {
        this.logger.warn(
          `Phát sự kiện cohort_member_removed sau khi settle hoàn tiền đã commit lỗi (refund=${outcome.settled.id}, payment=${payment.id}, cohort=${outcome.pendingRemoval.cohortId}, user=${outcome.pendingRemoval.userId}) — kết quả settle giữ nguyên, đồng bộ ghi danh đi qua hàng outbox đã ghi trong transaction: ${(error as Error).message}`,
        );
      }
    }
    return outcome.settled;
  }

  async settleRefund(actorId: string, paymentId: string, refundId: string, input: SettleRefund): Promise<PaymentRefund> {
    const payment = await this.getPayment(paymentId);
    await this.requireManageAccountsForTenant(actorId, payment.tenantId);
    const refund = await this.getRefundOfPayment(paymentId, refundId);
    if (refund.status !== 'approved') {
      badRequest('Refund is not approved for settlement', 'payment.refund_not_approved');
    }
    const externalTransactionId = input.externalTransactionId ?? refund.externalTransactionId;
    if (!externalTransactionId) {
      badRequest('A payout transaction reference is required to settle a refund', 'payment.refund_tx_required');
    }
    if (refund.externalTransactionId && input.externalTransactionId && refund.externalTransactionId !== input.externalTransactionId) {
      badRequest('Payout transaction reference does not match the reference recorded on the refund', 'payment.refund_tx_mismatch');
    }
    const settled = await this.applyRefundSettlement({
      payment, refund, externalTransactionId,
      settledBy: actorId, settledEventId: null, suspensionActorId: actorId,
    });
    return this.toRefundView(settled);
  }

  async settleRefundFromDebitEvent(event: ProviderEventRow): Promise<void> {
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
    const referenceCode = typeof raw['reference_code'] === 'string' ? raw['reference_code'] : typeof raw['referenceCode'] === 'string' ? raw['referenceCode'] : '';
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
  }

  async listRefunds(paymentId: string): Promise<PaymentRefund[]> {
    const rows = await this.repo.listRefunds(paymentId);
    return rows.map((r) => this.toRefundView(r));
  }


  private async reviewQueueScopeTenantIds(actorId: string): Promise<string[]> {
    const scope: string[] = [];
    const platformId = await this.platformTenantId();
    const sys = await this.contexts.ensureSystemContext();
    if (await this.evaluator.hasCapability(actorId, 'payment:manageaccounts', sys.id)) {
      scope.push(platformId);
    }
    const mine = await this.tenants.listMyTenants(actorId);
    for (const tenant of mine) {
      if (tenant.id === platformId || scope.includes(tenant.id)) continue;
      const ctx = await this.contexts.ensureTenantContext(tenant.id);
      if (await this.evaluator.hasCapability(actorId, 'payment:manageaccounts', ctx.id)) {
        scope.push(tenant.id);
      }
    }
    return scope;
  }

  async listReviewQueue(actorId: string): Promise<PaymentReviewQueueItem[]> {
    const scope = await this.reviewQueueScopeTenantIds(actorId);
    if (scope.length === 0) {
      forbidden('Missing capability payment:manageaccounts', 'access.capability_denied');
    }
    const now = Date.now();
    const items: PaymentReviewQueueItem[] = [];
    const targetHoursByTenant = new Map<string, Promise<number>>();
    const targetHoursFor = (tenantId: string): Promise<number> => {
      let cached = targetHoursByTenant.get(tenantId);
      if (!cached) {
        cached = this.reviewTargetHours(tenantId);
        targetHoursByTenant.set(tenantId, cached);
      }
      return cached;
    };
    const payments = await this.repo.listNeedsReviewPayments(scope);
    for (const payment of payments) {
      const event = await this.repo.getLatestEventForPayment(payment);
      const mismatches: PaymentReviewQueueItem['mismatches'] = [];
      if (event) {
        if (event.amount !== payment.amount) mismatches.push('amount_mismatch');
        if (event.accountId !== payment.accountId) mismatches.push('account_mismatch');
        if (payment.expiresAt && event.receivedAt.getTime() > payment.expiresAt.getTime()) mismatches.push('expired');
      }
      const ageHours = Math.max(0, (now - payment.updatedAt.getTime()) / 3_600_000);
      items.push({
        kind: 'payment',
        tenantId: payment.tenantId,
        payment: {
          id: payment.id, paymentCode: payment.paymentCode, amount: payment.amount,
          currency: payment.currency, component: payment.component, userId: payment.userId,
          expiresAt: payment.expiresAt ? payment.expiresAt.toISOString() : null,
          createdAt: payment.createdAt.toISOString(),
        },
        event: event ? {
          id: event.id, externalTransactionId: event.externalTransactionId, direction: event.direction as 'credit' | 'debit',
          amount: event.amount, extractedCode: event.extractedCode,
          receivedAt: event.receivedAt.toISOString(),
        } : null,
        mismatches,
        ageHours,
        overdue: ageHours > (await targetHoursFor(payment.tenantId)),
      });
    }
    const events = await this.repo.listNeedsReviewEvents(scope);
    for (const event of events) {
      if (!event.tenantId) continue;
      const ageHours = Math.max(0, (now - event.receivedAt.getTime()) / 3_600_000);
      items.push({
        kind: 'event',
        tenantId: event.tenantId,
        payment: null,
        event: {
          id: event.id, externalTransactionId: event.externalTransactionId, direction: event.direction as 'credit' | 'debit',
          amount: event.amount, extractedCode: event.extractedCode,
          receivedAt: event.receivedAt.toISOString(),
        },
        mismatches: [event.direction === 'debit' ? 'unmatched_debit' : 'unknown_code'],
        ageHours,
        overdue: ageHours > (await targetHoursFor(event.tenantId)),
      });
    }
    return items;
  }

  async resolvePaymentReview(actorId: string, paymentId: string, input: ResolvePaymentReview): Promise<PaymentView> {
    const payment = await this.getPayment(paymentId);
    await this.requireManageAccountsForTenant(actorId, payment.tenantId);
    if (payment.status !== 'needs_review') {
      badRequest('Payment is not waiting in the review queue', 'payment.not_in_review');
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      badRequest('A review resolution reason is required', 'payment.review_reason_required');
    }
    const trail = {
      reviewDecision: input.decision, reviewReason: reason,
      reviewHandledBy: actorId, reviewHandledAt: new Date(),
    };
    if (input.decision === 'rejected') {
      await this.repo.updatePayment(payment.id, { status: 'failed', ...trail });
      return this.getPayment(payment.id);
    }
    if (!(await this.verifyPaymentAgainstServerTarget(payment))) {
      badRequest('Payment amount or tenant does not match the server-side price and tenant of its target; refusing to activate entitlements', 'payment.target_mismatch');
    }
    const event = await this.repo.getLatestEventForPayment(payment);
    let externalTransactionId = payment.externalTransactionId;
    if (event) {
      const raw = (event.raw ?? {}) as Record<string, unknown>;
      const reference = typeof raw['reference_code'] === 'string' ? raw['reference_code'] : typeof raw['referenceCode'] === 'string' ? raw['referenceCode'] : null;
      externalTransactionId = reference ?? event.externalTransactionId;
    }
    if (payment.component === 'enrol_fee' && payment.itemId) {
      await this.enrol.activatePaidEnrol(payment.itemId, payment.userId);
    }
    if (payment.component === 'class_fee' && payment.itemId) {
      await this.classes.activatePaidClassEnrol(payment.itemId, payment.userId);
    }
    if (payment.component === 'tenant_plan' || payment.component === 'teacher_plan') {
      await this.plans.activateForPayment(payment);
    }
    await this.repo.updatePayment(payment.id, { status: 'succeeded', externalTransactionId, ...trail });
    const succeeded = await this.getPayment(payment.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'payment', type: 'payment_succeeded',
      payload: {
        paymentId: succeeded.id, userId: succeeded.userId, amount: succeeded.amount,
        currency: succeeded.currency, component: succeeded.component, itemId: succeeded.itemId,
        externalTransactionId: succeeded.externalTransactionId,
      },
    });
    return succeeded;
  }

  async listPaymentsForUser(userId: string): Promise<PaymentRow[]> { return this.repo.listPaymentsForUser(userId); }

  async reconcile(): Promise<{ total: number; succeeded: number; pendingWithoutExternalTx: number }> {
    return this.repo.countPaymentsForReconcile();
  }
}
