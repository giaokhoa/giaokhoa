import { Injectable } from '@nestjs/common';
import { sql, type CentreDB, type CentreDb, type CentreTx } from '@giaokhoa/db';
import type { DbTx } from './database';

type CentreJson = NonNullable<CentreDB['payments']['data']>;

function jsonbValue(value: unknown) {
  return sql<CentreJson>`${JSON.stringify(value)}::jsonb`;
}

export interface AccountRow {
  id: string;
  tenantId: string;
  name: string;
  gateway: string;
  enabled: boolean;
  config: unknown;
  createdAt: Date;
}

export interface PaymentRow {
  id: string;
  accountId: string;
  tenantId: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  externalTransactionId: string | null;
  component: string;
  itemId: string | null;
  paymentCode: string | null;
  expiresAt: Date | null;
  reviewDecision: string | null;
  reviewReason: string | null;
  reviewHandledBy: string | null;
  reviewHandledAt: Date | null;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundRow {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  reason: string;
  externalTransactionId: string | null;
  status: string;
  createdBy: string | null;
  approvalLevel: number | null;
  approvalThreshold: number | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  settledBy: string | null;
  settledEventId: string | null;
  settledAt: Date | null;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntitlementRow {
  id: string;
  tenantId: string;
  userId: string | null;
  component: string;
  paymentId: string;
  startsAt: Date;
  expiresAt: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CouponRow {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  appliesTo: string;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderEventRow {
  id: string;
  provider: string;
  tenantId: string | null;
  accountId: string | null;
  externalTransactionId: string;
  direction: string;
  amount: number;
  content: string;
  extractedCode: string | null;
  matchStatus: string;
  matchedPaymentId: string | null;
  receivedAt: Date;
  raw: unknown;
}

export interface AccountInsert {
  id?: string;
  tenantId: string;
  name: string;
  gateway?: string;
  enabled?: boolean;
  config?: unknown | null;
  createdAt?: Date;
}

export interface PaymentInsert {
  id?: string;
  accountId: string;
  tenantId: string;
  userId: string;
  amount: number;
  currency: string;
  status?: string;
  gateway?: string;
  externalTransactionId?: string | null;
  component?: string;
  itemId?: string | null;
  paymentCode?: string | null;
  expiresAt?: Date | null;
  reviewDecision?: string | null;
  reviewReason?: string | null;
  reviewHandledBy?: string | null;
  reviewHandledAt?: Date | null;
  data?: unknown | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RefundInsert {
  id?: string;
  paymentId: string;
  amount: number;
  currency: string;
  reason: string;
  externalTransactionId?: string | null;
  status?: string;
  createdBy: string;
  approvalLevel?: number;
  approvalThreshold?: number;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  rejectedBy?: string | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  settledBy?: string | null;
  settledEventId?: string | null;
  settledAt?: Date | null;
  data?: unknown | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EntitlementInsert {
  id?: string;
  tenantId: string;
  userId?: string | null;
  component: string;
  paymentId: string;
  startsAt: Date;
  expiresAt: Date;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CouponInsert {
  id?: string;
  code: string;
  discountType: string;
  discountValue: number;
  appliesTo: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
  isActive?: boolean;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProviderEventInsert {
  id?: string;
  provider: string;
  tenantId: string;
  accountId?: string | null;
  externalTransactionId: string;
  direction: string;
  amount: number;
  content?: string;
  extractedCode?: string | null;
  matchStatus?: string;
  matchedPaymentId?: string | null;
  receivedAt?: Date;
  raw?: unknown | null;
}

const ACCOUNT_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'name',
  'gateway',
  'enabled',
  'config',
  'created_at as createdAt',
] as const;

const PAYMENT_COLUMNS = [
  'id',
  'account_id as accountId',
  'tenant_id as tenantId',
  'user_id as userId',
  'amount',
  'currency',
  'status',
  'gateway',
  'external_transaction_id as externalTransactionId',
  'component',
  'item_id as itemId',
  'payment_code as paymentCode',
  'expires_at as expiresAt',
  'review_decision as reviewDecision',
  'review_reason as reviewReason',
  'review_handled_by as reviewHandledBy',
  'review_handled_at as reviewHandledAt',
  'data',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const REFUND_COLUMNS = [
  'id',
  'payment_id as paymentId',
  'amount',
  'currency',
  'reason',
  'external_transaction_id as externalTransactionId',
  'status',
  'created_by as createdBy',
  'approval_level as approvalLevel',
  'approval_threshold as approvalThreshold',
  'approved_by as approvedBy',
  'approved_at as approvedAt',
  'rejected_by as rejectedBy',
  'rejected_at as rejectedAt',
  'rejection_reason as rejectionReason',
  'settled_by as settledBy',
  'settled_event_id as settledEventId',
  'settled_at as settledAt',
  'data',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const ENTITLEMENT_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'user_id as userId',
  'component',
  'payment_id as paymentId',
  'starts_at as startsAt',
  'expires_at as expiresAt',
  'status',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const COUPON_COLUMNS = [
  'id',
  'code',
  'discount_type as discountType',
  'discount_value as discountValue',
  'applies_to as appliesTo',
  'starts_at as startsAt',
  'ends_at as endsAt',
  'max_redemptions as maxRedemptions',
  'is_active as isActive',
  'created_by as createdBy',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const PROVIDER_EVENT_COLUMNS = [
  'id',
  'provider',
  'tenant_id as tenantId',
  'account_id as accountId',
  'external_transaction_id as externalTransactionId',
  'direction',
  'amount',
  'content',
  'extracted_code as extractedCode',
  'match_status as matchStatus',
  'matched_payment_id as matchedPaymentId',
  'received_at as receivedAt',
  'raw',
] as const;

function stripUndefined<T extends Record<string, unknown>>(values: T): T {
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) delete values[key];
  }
  return values;
}

function mapAccountInsert(input: AccountInsert) {
  return stripUndefined({
    id: input.id,
    tenant_id: input.tenantId,
    name: input.name,
    gateway: input.gateway,
    enabled: input.enabled,
    config: input.config === undefined || input.config === null ? input.config ?? undefined : jsonbValue(input.config),
    created_at: input.createdAt,
  });
}

function mapPaymentInsert(input: PaymentInsert) {
  return stripUndefined({
    id: input.id,
    account_id: input.accountId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    amount: input.amount,
    currency: input.currency,
    status: input.status,
    gateway: input.gateway,
    external_transaction_id: input.externalTransactionId,
    component: input.component,
    item_id: input.itemId,
    payment_code: input.paymentCode,
    expires_at: input.expiresAt,
    review_decision: input.reviewDecision,
    review_reason: input.reviewReason,
    review_handled_by: input.reviewHandledBy,
    review_handled_at: input.reviewHandledAt,
    data: input.data === undefined || input.data === null ? input.data ?? undefined : jsonbValue(input.data),
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

function mapRefundInsert(input: RefundInsert) {
  return stripUndefined({
    id: input.id,
    payment_id: input.paymentId,
    amount: input.amount,
    currency: input.currency,
    reason: input.reason,
    external_transaction_id: input.externalTransactionId,
    status: input.status,
    created_by: input.createdBy,
    approval_level: input.approvalLevel,
    approval_threshold: input.approvalThreshold,
    approved_by: input.approvedBy,
    approved_at: input.approvedAt,
    rejected_by: input.rejectedBy,
    rejected_at: input.rejectedAt,
    rejection_reason: input.rejectionReason,
    settled_by: input.settledBy,
    settled_event_id: input.settledEventId,
    settled_at: input.settledAt,
    data: input.data === undefined || input.data === null ? input.data ?? undefined : jsonbValue(input.data),
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

function mapEntitlementInsert(input: EntitlementInsert) {
  return stripUndefined({
    id: input.id,
    tenant_id: input.tenantId,
    user_id: input.userId,
    component: input.component,
    payment_id: input.paymentId,
    starts_at: input.startsAt,
    expires_at: input.expiresAt,
    status: input.status,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

function mapCouponInsert(input: CouponInsert) {
  return stripUndefined({
    id: input.id,
    code: input.code,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    applies_to: input.appliesTo,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    max_redemptions: input.maxRedemptions,
    is_active: input.isActive,
    created_by: input.createdBy,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

function mapProviderEventInsert(input: ProviderEventInsert) {
  return stripUndefined({
    id: input.id,
    provider: input.provider,
    tenant_id: input.tenantId,
    account_id: input.accountId,
    external_transaction_id: input.externalTransactionId,
    direction: input.direction,
    amount: input.amount,
    content: input.content,
    extracted_code: input.extractedCode,
    match_status: input.matchStatus,
    matched_payment_id: input.matchedPaymentId,
    received_at: input.receivedAt,
    raw: input.raw === undefined || input.raw === null ? input.raw ?? undefined : jsonbValue(input.raw),
  });
}

@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: CentreDb) {}

  get dbHandle(): CentreDb {
    return this.db;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(fn);
  }

  async insertAccount(input: AccountInsert): Promise<AccountRow> {
    return this.db
      .insertInto('payment_accounts')
      .values(mapAccountInsert(input))
      .returning(ACCOUNT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getAccount(id: string): Promise<AccountRow | undefined> {
    return this.db.selectFrom('payment_accounts').select(ACCOUNT_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async listAccounts(): Promise<AccountRow[]> {
    return this.db.selectFrom('payment_accounts').select(ACCOUNT_COLUMNS).execute();
  }

  async insertPayment(input: PaymentInsert): Promise<PaymentRow> {
    return this.db
      .insertInto('payments')
      .values(mapPaymentInsert(input))
      .returning(PAYMENT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getPayment(id: string): Promise<PaymentRow | undefined> {
    return this.db.selectFrom('payments').select(PAYMENT_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async getByExternalTx(gateway: string, externalTransactionId: string): Promise<PaymentRow | undefined> {
    return this.db
      .selectFrom('payments')
      .select(PAYMENT_COLUMNS)
      .where('gateway', '=', gateway)
      .where('external_transaction_id', '=', externalTransactionId)
      .executeTakeFirst();
  }

  async listPayments(): Promise<PaymentRow[]> {
    return this.db.selectFrom('payments').select(PAYMENT_COLUMNS).execute();
  }

  async countPaymentsForReconcile(): Promise<{ total: number; succeeded: number; pendingWithoutExternalTx: number }> {
    const row = await this.db
      .selectFrom('payments')
      .select([
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(*) filter (where status = 'succeeded')::int`.as('succeeded'),
        sql<number>`count(*) filter (where status = 'pending' and (external_transaction_id is null or external_transaction_id = ''))::int`.as(
          'pendingWithoutExternalTx',
        ),
      ])
      .executeTakeFirst();
    return {
      total: row?.total ?? 0,
      succeeded: row?.succeeded ?? 0,
      pendingWithoutExternalTx: row?.pendingWithoutExternalTx ?? 0,
    };
  }

  async listPaymentsForUser(userId: string): Promise<PaymentRow[]> {
    return this.db
      .selectFrom('payments')
      .select(PAYMENT_COLUMNS)
      .where('user_id', '=', userId)
      .execute();
  }

  async updatePayment(id: string, patch: Partial<PaymentInsert>, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .updateTable('payments')
      .set({ ...mapPaymentInsert(patch as PaymentInsert), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertRefund(input: RefundInsert, tx?: DbTx): Promise<RefundRow> {
    const db = tx ?? this.db;
    return db
      .insertInto('payment_refunds')
      .values(mapRefundInsert(input))
      .returning(REFUND_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async listRefunds(paymentId: string): Promise<RefundRow[]> {
    return this.db
      .selectFrom('payment_refunds')
      .select(REFUND_COLUMNS)
      .where('payment_id', '=', paymentId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async sumRefunds(paymentId: string): Promise<number> {
    const row = await this.db
      .selectFrom('payment_refunds')
      .select(sql<number>`coalesce(sum(amount), 0)::int`.as('total'))
      .where('payment_id', '=', paymentId)
      .executeTakeFirst();
    return row?.total ?? 0;
  }

  async getRefund(id: string, tx?: DbTx): Promise<RefundRow | undefined> {
    const db = tx ?? this.db;
    return db.selectFrom('payment_refunds').select(REFUND_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async updateRefund(id: string, patch: Partial<RefundInsert>, tx?: DbTx): Promise<RefundRow> {
    const db = tx ?? this.db;
    return db
      .updateTable('payment_refunds')
      .set({ ...mapRefundInsert(patch as RefundInsert), updated_at: new Date() })
      .where('id', '=', id)
      .returning(REFUND_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async updateRefundFromStatuses(
    id: string,
    fromStatuses: string[],
    patch: Partial<RefundInsert>,
    tx?: DbTx,
  ): Promise<RefundRow | undefined> {
    const db = tx ?? this.db;
    return db
      .updateTable('payment_refunds')
      .set({ ...mapRefundInsert(patch as RefundInsert), updated_at: new Date() })
      .where('id', '=', id)
      .where('status', 'in', fromStatuses)
      .returning(REFUND_COLUMNS)
      .executeTakeFirst();
  }

  async sumRefundsByStatuses(paymentId: string, statuses: string[], tx?: DbTx): Promise<number> {
    const db = tx ?? this.db;
    const row = await db
      .selectFrom('payment_refunds')
      .select(sql<number>`coalesce(sum(amount), 0)::int`.as('total'))
      .where('payment_id', '=', paymentId)
      .where('status', 'in', statuses)
      .executeTakeFirst();
    return row?.total ?? 0;
  }

  async findRefundCandidateForDebit(input: {
    accountId: string;
    amount: number;
    transactionIds: string[];
  }): Promise<{ refund: RefundRow; payment: PaymentRow } | undefined> {
    const ids = input.transactionIds.filter((v) => v.length > 0);
    if (ids.length === 0) return undefined;
    const row = await this.db
      .selectFrom('payment_refunds')
      .innerJoin('payments', 'payments.id', 'payment_refunds.payment_id')
      .select([
        'payment_refunds.id as refund_id',
        'payment_refunds.payment_id as refund_payment_id',
        'payment_refunds.amount as refund_amount',
        'payment_refunds.currency as refund_currency',
        'payment_refunds.reason as refund_reason',
        'payment_refunds.external_transaction_id as refund_external_transaction_id',
        'payment_refunds.status as refund_status',
        'payment_refunds.created_by as refund_created_by',
        'payment_refunds.approval_level as refund_approval_level',
        'payment_refunds.approval_threshold as refund_approval_threshold',
        'payment_refunds.approved_by as refund_approved_by',
        'payment_refunds.approved_at as refund_approved_at',
        'payment_refunds.rejected_by as refund_rejected_by',
        'payment_refunds.rejected_at as refund_rejected_at',
        'payment_refunds.rejection_reason as refund_rejection_reason',
        'payment_refunds.settled_by as refund_settled_by',
        'payment_refunds.settled_event_id as refund_settled_event_id',
        'payment_refunds.settled_at as refund_settled_at',
        'payment_refunds.data as refund_data',
        'payment_refunds.created_at as refund_created_at',
        'payment_refunds.updated_at as refund_updated_at',
        'payments.id as payment_id',
        'payments.account_id as payment_account_id',
        'payments.tenant_id as payment_tenant_id',
        'payments.user_id as payment_user_id',
        'payments.amount as payment_amount',
        'payments.currency as payment_currency',
        'payments.status as payment_status',
        'payments.gateway as payment_gateway',
        'payments.external_transaction_id as payment_external_transaction_id',
        'payments.component as payment_component',
        'payments.item_id as payment_item_id',
        'payments.payment_code as payment_payment_code',
        'payments.expires_at as payment_expires_at',
        'payments.review_decision as payment_review_decision',
        'payments.review_reason as payment_review_reason',
        'payments.review_handled_by as payment_review_handled_by',
        'payments.review_handled_at as payment_review_handled_at',
        'payments.data as payment_data',
        'payments.created_at as payment_created_at',
        'payments.updated_at as payment_updated_at',
      ])
      .where('payment_refunds.status', '=', 'approved')
      .where('payments.account_id', '=', input.accountId)
      .where('payment_refunds.amount', '=', input.amount)
      .where('payment_refunds.external_transaction_id', 'in', ids)
      .orderBy('payment_refunds.created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      refund: {
        id: row.refund_id,
        paymentId: row.refund_payment_id,
        amount: row.refund_amount,
        currency: row.refund_currency,
        reason: row.refund_reason,
        externalTransactionId: row.refund_external_transaction_id,
        status: row.refund_status,
        createdBy: row.refund_created_by,
        approvalLevel: row.refund_approval_level,
        approvalThreshold: row.refund_approval_threshold,
        approvedBy: row.refund_approved_by,
        approvedAt: row.refund_approved_at,
        rejectedBy: row.refund_rejected_by,
        rejectedAt: row.refund_rejected_at,
        rejectionReason: row.refund_rejection_reason,
        settledBy: row.refund_settled_by,
        settledEventId: row.refund_settled_event_id,
        settledAt: row.refund_settled_at,
        data: row.refund_data,
        createdAt: row.refund_created_at,
        updatedAt: row.refund_updated_at,
      },
      payment: {
        id: row.payment_id,
        accountId: row.payment_account_id,
        tenantId: row.payment_tenant_id,
        userId: row.payment_user_id,
        amount: row.payment_amount,
        currency: row.payment_currency,
        status: row.payment_status,
        gateway: row.payment_gateway,
        externalTransactionId: row.payment_external_transaction_id,
        component: row.payment_component,
        itemId: row.payment_item_id,
        paymentCode: row.payment_payment_code,
        expiresAt: row.payment_expires_at,
        reviewDecision: row.payment_review_decision,
        reviewReason: row.payment_review_reason,
        reviewHandledBy: row.payment_review_handled_by,
        reviewHandledAt: row.payment_review_handled_at,
        data: row.payment_data,
        createdAt: row.payment_created_at,
        updatedAt: row.payment_updated_at,
      },
    };
  }

  async getRefundBySettledEventId(eventId: string): Promise<RefundRow | undefined> {
    return this.db
      .selectFrom('payment_refunds')
      .select(REFUND_COLUMNS)
      .where('settled_event_id', '=', eventId)
      .executeTakeFirst();
  }

  async listNeedsReviewPayments(tenantIds: string[]): Promise<PaymentRow[]> {
    if (tenantIds.length === 0) return [];
    return this.db
      .selectFrom('payments')
      .select(PAYMENT_COLUMNS)
      .where('status', '=', 'needs_review')
      .where('tenant_id', 'in', tenantIds)
      .orderBy('updated_at', 'asc')
      .execute();
  }

  async listNeedsReviewEvents(tenantIds: string[]): Promise<ProviderEventRow[]> {
    if (tenantIds.length === 0) return [];
    return this.db
      .selectFrom('payment_provider_events')
      .select(PROVIDER_EVENT_COLUMNS)
      .where('match_status', '=', 'needs_review')
      .where('matched_payment_id', 'is', null)
      .where('tenant_id', 'in', tenantIds)
      .orderBy('received_at', 'asc')
      .execute();
  }

  async getLatestEventForPayment(payment: PaymentRow): Promise<ProviderEventRow | undefined> {
    return this.db
      .selectFrom('payment_provider_events')
      .select(PROVIDER_EVENT_COLUMNS)
      .where((eb) => {
        const ors = [eb('matched_payment_id', '=', payment.id)];
        if (payment.paymentCode) ors.push(eb('extracted_code', '=', payment.paymentCode));
        return eb.or(ors);
      })
      .orderBy('received_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  async nextPaymentCodeValue(): Promise<number> {
    const result = await sql<{ v: number }>`select nextval('payment_code_seq')::int as v`.execute(this.db);
    return result.rows[0]!.v;
  }

  async getPaymentByCode(code: string): Promise<PaymentRow | undefined> {
    return this.db.selectFrom('payments').select(PAYMENT_COLUMNS).where('payment_code', '=', code).executeTakeFirst();
  }

  async getCourseTenantId(courseId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('course')
      .select('tenant_id as tenantId')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.tenantId;
  }

  async findAccountBySepayXid(xid: string): Promise<AccountRow | undefined> {
    return this.db
      .selectFrom('payment_accounts')
      .select(ACCOUNT_COLUMNS)
      .where(sql<boolean>`"config"->>'sepayBankAccountXid' = ${xid}`)
      .executeTakeFirst();
  }

  async findAccountByBankNumber(accountNumber: string): Promise<AccountRow | undefined> {
    return this.db
      .selectFrom('payment_accounts')
      .select(ACCOUNT_COLUMNS)
      .where(sql<boolean>`"config"->>'bankAccountNumber' = ${accountNumber}`)
      .executeTakeFirst();
  }

  async insertProviderEvent(input: ProviderEventInsert): Promise<ProviderEventRow | undefined> {
    return this.db
      .insertInto('payment_provider_events')
      .values(mapProviderEventInsert(input))
      .onConflict((oc) => oc.columns(['provider', 'external_transaction_id']).doNothing())
      .returning(PROVIDER_EVENT_COLUMNS)
      .executeTakeFirst();
  }

  async getProviderEvent(id: string): Promise<ProviderEventRow | undefined> {
    return this.db
      .selectFrom('payment_provider_events')
      .select(PROVIDER_EVENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getProviderEventByTx(provider: string, externalTransactionId: string): Promise<ProviderEventRow | undefined> {
    return this.db
      .selectFrom('payment_provider_events')
      .select(PROVIDER_EVENT_COLUMNS)
      .where('provider', '=', provider)
      .where('external_transaction_id', '=', externalTransactionId)
      .executeTakeFirst();
  }

  async listPendingProviderEvents(limit: number, staleProcessingBefore: Date): Promise<ProviderEventRow[]> {
    return this.db
      .selectFrom('payment_provider_events')
      .select(PROVIDER_EVENT_COLUMNS)
      .where((eb) =>
        eb.or([
          eb('match_status', '=', 'received'),
          eb.and([
            eb('match_status', '=', 'processing'),
            eb('received_at', '<', staleProcessingBefore),
          ]),
        ]),
      )
      .orderBy('received_at', 'asc')
      .limit(limit)
      .execute();
  }

  async claimProviderEvent(id: string): Promise<boolean> {
    const result = await this.db
      .updateTable('payment_provider_events')
      .set({ match_status: 'processing' })
      .where('id', '=', id)
      .where('match_status', 'in', ['received', 'processing'])
      .returning('id')
      .execute();
    return result.length > 0;
  }

  async updateProviderEvent(id: string, patch: Partial<ProviderEventInsert>): Promise<void> {
    await this.db
      .updateTable('payment_provider_events')
      .set(mapProviderEventInsert(patch as ProviderEventInsert))
      .where('id', '=', id)
      .execute();
  }

  async insertEntitlement(input: EntitlementInsert): Promise<EntitlementRow> {
    return this.db
      .insertInto('plan_entitlements')
      .values(mapEntitlementInsert(input))
      .returning(ENTITLEMENT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getEntitlementByPayment(paymentId: string): Promise<EntitlementRow | undefined> {
    return this.db
      .selectFrom('plan_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .where('payment_id', '=', paymentId)
      .executeTakeFirst();
  }

  async maxActiveEntitlementExpiry(
    component: string,
    tenantId: string,
    userId: string | null,
  ): Promise<Date | null> {
    let query = this.db
      .selectFrom('plan_entitlements')
      .select(sql<Date | null>`max(expires_at)`.as('m'))
      .where('component', '=', component)
      .where('status', '=', 'active');
    if (userId) {
      query = query.where('user_id', '=', userId);
    } else {
      query = query.where('tenant_id', '=', tenantId).where('user_id', 'is', null);
    }
    const row = await query.executeTakeFirst();
    return row?.m ? new Date(row.m) : null;
  }

  async listEntitlementsForUser(userId: string): Promise<EntitlementRow[]> {
    return this.db
      .selectFrom('plan_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('starts_at', 'asc')
      .execute();
  }

  async listTenantPlanEntitlements(tenantId: string): Promise<EntitlementRow[]> {
    return this.db
      .selectFrom('plan_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('user_id', 'is', null)
      .orderBy('starts_at', 'asc')
      .execute();
  }

  async suspendEntitlementsByPayment(paymentId: string, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .updateTable('plan_entitlements')
      .set({ status: 'suspended', updated_at: new Date() })
      .where('payment_id', '=', paymentId)
      .execute();
  }

  async insertCoupon(input: CouponInsert): Promise<CouponRow> {
    return this.db
      .insertInto('payment_coupons')
      .values(mapCouponInsert(input))
      .returning(COUPON_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getCoupon(id: string): Promise<CouponRow | undefined> {
    return this.db.selectFrom('payment_coupons').select(COUPON_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async getCouponByCode(code: string): Promise<CouponRow | undefined> {
    return this.db.selectFrom('payment_coupons').select(COUPON_COLUMNS).where('code', '=', code).executeTakeFirst();
  }

  async listCoupons(): Promise<CouponRow[]> {
    return this.db.selectFrom('payment_coupons').select(COUPON_COLUMNS).orderBy('created_at', 'asc').execute();
  }

  async updateCoupon(id: string, patch: Partial<CouponInsert>): Promise<CouponRow> {
    return this.db
      .updateTable('payment_coupons')
      .set({ ...mapCouponInsert(patch as CouponInsert), updated_at: new Date() })
      .where('id', '=', id)
      .returning(COUPON_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async countCouponRedemptions(couponId: string): Promise<number> {
    const row = await this.db
      .selectFrom('payments')
      .select(sql<number>`count(*)::int`.as('total'))
      .where('component', 'in', ['tenant_plan', 'teacher_plan'])
      .where('status', 'in', ['pending', 'succeeded'])
      .where(sql<boolean>`"data"->'plan'->>'couponId' = ${couponId}`)
      .executeTakeFirst();
    return row?.total ?? 0;
  }
}
