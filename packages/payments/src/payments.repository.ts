import { Injectable } from '@nestjs/common';
import { sql, type CentreDB, type CentreDb, type CentreTx } from '@giaokhoa/db';
import type { DbTx } from './database';

/**
 * Kiểu JSON của cột jsonb theo codegen của kho trung tâm — đồng cấu trúc với `JsonValue` của Kysely nên biểu thức SQL mang kiểu này gán được cho mọi cột jsonb. Lấy qua chỉ mục bảng thay vì import trực tiếp từ `kysely` (barrel `@giaokhoa/db` không re-export kiểu đó). Helper này cố tình KHÔNG export khỏi package: kiểu trả về của `sql` tham chiếu tới kiểu của `kysely` mà `package.json` của package không khai phụ thuộc, nên đưa nó vào `.d.ts` công khai sẽ làm build lỗi TS2883 — mỗi file cần ghi jsonb giữ một bản private giống hệt nhau thay vì một helper export chung.
 */
type CentreJson = NonNullable<CentreDB['payments']['data']>;

/**
 * Xâu hoá một giá trị jsonb để ghi qua Kysely, đúng khuôn sổ tay chuyển đổi của `@giaokhoa/db`.
 *
 * Driver `pg` tự stringify object thường nhưng hiểu MẢNG cấp cao nhất là mảng PostgreSQL, nên mọi lần ghi jsonb đều xâu hoá trước rồi ép kiểu `::jsonb` trong SQL — kể cả khi giá trị là object
 * (để mọi đường ghi jsonb dùng chung một cơ chế, không tuỳ từng
 * hình dạng). `null` không đi qua đây: cột jsonb nullable nhận `null` thẳng để ghi SQL NULL, không ghi JSON `null`.
 */
function jsonbValue(value: unknown) {
  return sql<CentreJson>`${JSON.stringify(value)}::jsonb`;
}

/**
 * Dòng account thanh toán (đọc từ `payment_accounts`).
 *
 * `config` là cột jsonb: khi đọc, driver trả về giá trị đã giải mã
 * (object/mảng/số/chuỗi/boolean/null), không phải chuỗi JSON; phía
 * gọi tự ép kiểu sang hình dạng config cụ thể khi cần.
 */
export interface AccountRow {
  id: string;
  tenantId: string;
  name: string;
  gateway: string;
  enabled: boolean;
  config: unknown;
  createdAt: Date;
}

/** Dòng khoản thu (đọc từ `payments`). */
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

/**
 * Dòng hoàn tiền (đọc từ `payment_refunds`).
 *
 * Nullability theo đúng kiểu sinh codegen của kho trung tâm (nguồn
 * thật là DB): `created_by`, `approval_level`,
 * `approval_threshold` đều nullable trong DB — khác với khai báo
 * `.notNull()` cũ của schema bộ máy cũ; contract `@giaokhoa/contracts`
 * cũng đã khai nullable cho đúng ba trường này nên phía gọi không
 * đổi gì.
 */
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

/** Dòng quyền lợi gói (đọc từ `plan_entitlements`). */
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

/** Dòng coupon giảm giá (đọc từ `payment_coupons`). */
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
  // Nullable trong DB theo codegen (contract cũng khai nullable).
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dòng sự kiện thô của cổng (đọc từ `payment_provider_events`).
 *
 * Bảng này KHÔNG có `created_at`/`updated_at` (theo codegen) — chỉ
 * có `received_at` làm mốc thời gian. `tenant_id` nullable trong
 * DB (sự kiện chưa định tuyến được account nào vẫn ghi sổ với
 * tenant null); `amount` và `content` bắt buộc có.
 */
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

/**
 * Dữ kiện ghi account mới. Các cột có giá trị mặc định ở DB
 * (`id`, `gateway`, `enabled`, `created_at`) được phép bỏ qua; cột
 * jsonb `config` nhận giá trị đã giải mã, hoặc null để ghi SQL NULL.
 */
export interface AccountInsert {
  id?: string;
  tenantId: string;
  name: string;
  gateway?: string;
  enabled?: boolean;
  config?: unknown | null;
  createdAt?: Date;
}

/** Dữ kiện ghi khoản thu mới. */
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

/** Dữ kiện ghi hoàn tiền mới. */
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

/** Dữ kiện ghi quyền lợi gói mới. */
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

/** Dữ kiện ghi coupon mới. */
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

/**
 * Dữ kiện ghi sự kiện thô mới của cổng (bảng không có
 * `created_at`/`updated_at`). `amount` bắt buộc có vì cột này
 * không nullable và không có mặc định trong DB.
 */
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

/**
 * Danh sách cột đọc của từng bảng, bí danh về tên camelCase của
 * interface dòng tương ứng. Mọi SELECT/RETURNING của repository đều
 * dùng đúng danh sách này — không đọc `*`, không để kiểu dòng suy
 * từ cột snake_case rồi ép kiểu ở biên.
 */
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

/**
 * Một trường của mapper insert: cột snake_case trong DB, khoá camelCase tương ứng trên input, và cờ cột jsonb.
 * Sáu mapper `map*Insert` chỉ là bảng trường này gọi vào {@link mapInsert} — thêm một cột thì thêm một dòng vào bảng (cùng interface Insert và danh sách cột đọc), không sửa khuôn ánh xạ.
 */
interface InsertFieldSpec<Input, Key extends keyof Input & string> {
  /** Tên cột snake_case trong DB. */
  column: string;
  /** Khoá camelCase tương ứng trên input. */
  key: Key;
  /** Cột jsonb: giá trị đã giải mã được xâu hoá qua `jsonbValue`; `null` giữ nguyên để ghi SQL NULL. */
  jsonb?: boolean;
}

/**
 * Kiểu object ghi mà {@link mapInsert} dựng từ một bảng trường: cột thường giữ nguyên kiểu của khoá input tương ứng; cột jsonb cho ra biểu thức SQL của `jsonbValue` (hoặc `null` để ghi SQL NULL).
 */
type MappedInsert<Input, Fields extends readonly InsertFieldSpec<Input, keyof Input & string>[]> = {
  [Field in Fields[number] as Field['column']]: Field extends { jsonb: true }
    ? ReturnType<typeof jsonbValue> | null
    : Input[Field['key']];
};

/**
 * Mapper insert chung cho cả sáu bảng: duyệt bảng trường, bỏ qua khoá `undefined` (cột lấy mặc định của DB), xâu hoá cột jsonb qua `jsonbValue`, và GIỮ NGUYÊN `null` — kể cả ở cột jsonb — để ghi SQL NULL tường minh. Nhờ đó đường UPDATE xoá được giá trị jsonb đã có về null; trước đây `null` bị biến thành `undefined` rồi xoá khoá khỏi `SET` nên giá trị cũ còn nguyên, lệch với comment của `jsonbValue` và TSDoc của `AccountInsert`. An toàn vì cả bốn cột jsonb (`payment_accounts.config`, `payments.data`, `payment_refunds.data`, `payment_provider_events.raw`) đều nullable và không có default khác NULL; đường INSERT ghi `null` tường minh cho cùng kết quả như trước (lấy default NULL).
 *
 * Trả object MỚI, không mutate input (khác `stripUndefined` cũ vốn `delete` trực tiếp trên object nhận vào). Ép kiểu ở `return` là có chủ đích và chỉ nằm ở đây: TypeScript không chứng minh được vòng lặp dựng object động khớp đúng kiểu ánh xạ `MappedInsert` theo từng bảng trường, nên sáu mapper gọi lại đều nhận đúng kiểu của bảng mình mà không cần ép kiểu ở chỗ gọi.
 */
function mapInsert<Input extends object, Fields extends readonly InsertFieldSpec<Input, keyof Input & string>[]>(
  input: Partial<Input>,
  fields: Fields,
): MappedInsert<Input, Fields> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field.key];
    if (value === undefined) continue;
    values[field.column] = field.jsonb && value !== null ? jsonbValue(value) : value;
  }
  return values as MappedInsert<Input, Fields>;
}

/** Bảng trường của `mapAccountInsert` (xem {@link mapInsert}). */
const ACCOUNT_INSERT_FIELDS = [
  { column: 'id', key: 'id' },
  { column: 'tenant_id', key: 'tenantId' },
  { column: 'name', key: 'name' },
  { column: 'gateway', key: 'gateway' },
  { column: 'enabled', key: 'enabled' },
  { column: 'config', key: 'config', jsonb: true },
  { column: 'created_at', key: 'createdAt' },
] as const;

/** Ánh xạ ghi account mới: camelCase → snake_case qua {@link mapInsert}; nhận `Partial` nên đường cập nhật dùng thẳng không cần ép kiểu. */
function mapAccountInsert(input: Partial<AccountInsert>) {
  return mapInsert(input, ACCOUNT_INSERT_FIELDS);
}

/** Bảng trường của `mapPaymentInsert` (xem {@link mapInsert}). */
const PAYMENT_INSERT_FIELDS = [
  { column: 'id', key: 'id' },
  { column: 'account_id', key: 'accountId' },
  { column: 'tenant_id', key: 'tenantId' },
  { column: 'user_id', key: 'userId' },
  { column: 'amount', key: 'amount' },
  { column: 'currency', key: 'currency' },
  { column: 'status', key: 'status' },
  { column: 'gateway', key: 'gateway' },
  { column: 'external_transaction_id', key: 'externalTransactionId' },
  { column: 'component', key: 'component' },
  { column: 'item_id', key: 'itemId' },
  { column: 'payment_code', key: 'paymentCode' },
  { column: 'expires_at', key: 'expiresAt' },
  { column: 'review_decision', key: 'reviewDecision' },
  { column: 'review_reason', key: 'reviewReason' },
  { column: 'review_handled_by', key: 'reviewHandledBy' },
  { column: 'review_handled_at', key: 'reviewHandledAt' },
  { column: 'data', key: 'data', jsonb: true },
  { column: 'created_at', key: 'createdAt' },
  { column: 'updated_at', key: 'updatedAt' },
] as const;

/** Ánh xạ ghi khoản thu mới: camelCase → snake_case qua {@link mapInsert}; nhận `Partial` nên đường cập nhật dùng thẳng không cần ép kiểu. */
function mapPaymentInsert(input: Partial<PaymentInsert>) {
  return mapInsert(input, PAYMENT_INSERT_FIELDS);
}

/** Bảng trường của `mapRefundInsert` (xem {@link mapInsert}). */
const REFUND_INSERT_FIELDS = [
  { column: 'id', key: 'id' },
  { column: 'payment_id', key: 'paymentId' },
  { column: 'amount', key: 'amount' },
  { column: 'currency', key: 'currency' },
  { column: 'reason', key: 'reason' },
  { column: 'external_transaction_id', key: 'externalTransactionId' },
  { column: 'status', key: 'status' },
  { column: 'created_by', key: 'createdBy' },
  { column: 'approval_level', key: 'approvalLevel' },
  { column: 'approval_threshold', key: 'approvalThreshold' },
  { column: 'approved_by', key: 'approvedBy' },
  { column: 'approved_at', key: 'approvedAt' },
  { column: 'rejected_by', key: 'rejectedBy' },
  { column: 'rejected_at', key: 'rejectedAt' },
  { column: 'rejection_reason', key: 'rejectionReason' },
  { column: 'settled_by', key: 'settledBy' },
  { column: 'settled_event_id', key: 'settledEventId' },
  { column: 'settled_at', key: 'settledAt' },
  { column: 'data', key: 'data', jsonb: true },
  { column: 'created_at', key: 'createdAt' },
  { column: 'updated_at', key: 'updatedAt' },
] as const;

/** Ánh xạ ghi hoàn tiền mới: camelCase → snake_case qua {@link mapInsert}; nhận `Partial` nên đường cập nhật dùng thẳng không cần ép kiểu. */
function mapRefundInsert(input: Partial<RefundInsert>) {
  return mapInsert(input, REFUND_INSERT_FIELDS);
}

/** Bảng trường của `mapEntitlementInsert` (xem {@link mapInsert}). */
const ENTITLEMENT_INSERT_FIELDS = [
  { column: 'id', key: 'id' },
  { column: 'tenant_id', key: 'tenantId' },
  { column: 'user_id', key: 'userId' },
  { column: 'component', key: 'component' },
  { column: 'payment_id', key: 'paymentId' },
  { column: 'starts_at', key: 'startsAt' },
  { column: 'expires_at', key: 'expiresAt' },
  { column: 'status', key: 'status' },
  { column: 'created_at', key: 'createdAt' },
  { column: 'updated_at', key: 'updatedAt' },
] as const;

/** Ánh xạ ghi quyền lợi gói mới: camelCase → snake_case qua {@link mapInsert}. */
function mapEntitlementInsert(input: Partial<EntitlementInsert>) {
  return mapInsert(input, ENTITLEMENT_INSERT_FIELDS);
}

/** Bảng trường của `mapCouponInsert` (xem {@link mapInsert}). */
const COUPON_INSERT_FIELDS = [
  { column: 'id', key: 'id' },
  { column: 'code', key: 'code' },
  { column: 'discount_type', key: 'discountType' },
  { column: 'discount_value', key: 'discountValue' },
  { column: 'applies_to', key: 'appliesTo' },
  { column: 'starts_at', key: 'startsAt' },
  { column: 'ends_at', key: 'endsAt' },
  { column: 'max_redemptions', key: 'maxRedemptions' },
  { column: 'is_active', key: 'isActive' },
  { column: 'created_by', key: 'createdBy' },
  { column: 'created_at', key: 'createdAt' },
  { column: 'updated_at', key: 'updatedAt' },
] as const;

/** Ánh xạ ghi coupon mới: camelCase → snake_case qua {@link mapInsert}; nhận `Partial` nên đường cập nhật dùng thẳng không cần ép kiểu. */
function mapCouponInsert(input: Partial<CouponInsert>) {
  return mapInsert(input, COUPON_INSERT_FIELDS);
}

/** Bảng trường của `mapProviderEventInsert` (xem {@link mapInsert}). */
const PROVIDER_EVENT_INSERT_FIELDS = [
  { column: 'id', key: 'id' },
  { column: 'provider', key: 'provider' },
  { column: 'tenant_id', key: 'tenantId' },
  { column: 'account_id', key: 'accountId' },
  { column: 'external_transaction_id', key: 'externalTransactionId' },
  { column: 'direction', key: 'direction' },
  { column: 'amount', key: 'amount' },
  { column: 'content', key: 'content' },
  { column: 'extracted_code', key: 'extractedCode' },
  { column: 'match_status', key: 'matchStatus' },
  { column: 'matched_payment_id', key: 'matchedPaymentId' },
  { column: 'received_at', key: 'receivedAt' },
  { column: 'raw', key: 'raw', jsonb: true },
] as const;

/** Ánh xạ ghi sự kiện thô mới của cổng: camelCase → snake_case qua {@link mapInsert}; nhận `Partial` nên đường cập nhật dùng thẳng không cần ép kiểu. */
function mapProviderEventInsert(input: Partial<ProviderEventInsert>) {
  return mapInsert(input, PROVIDER_EVENT_INSERT_FIELDS);
}

/**
 * Kho dữ liệu payment_accounts / payments / payment_refunds.
 *
 * Repository này là tầng truy cập dữ liệu thanh toán của package
 * dùng chung `@giaokhoa/payments` (issue #538): nó chỉ thao tác dữ liệu
 * qua Kysely trên kho trung tâm của `@giaokhoa/db`, không chứa luật
 * nghiệp vụ và không phụ thuộc module nào của tiến trình chủ — mọi
 * phía (facade thanh toán phía apps/api, luồng matching dùng chung)
 * dùng đúng repository này, không có bản sao thứ hai.
 *
 * Các method ghi của vòng đời hoàn tiền (lát 3, issue #189) nhận
 * transaction tuỳ chọn để cổng cộng dồn chạy trong MỘT transaction
 * có khoá dòng `payments`.
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: CentreDb) {}

  /** Handle kho trung tâm đã tiêm — tiến trình chủ dùng khi cần mở transaction. */
  get dbHandle(): CentreDb {
    return this.db;
  }

  /**
   * Mở một transaction Kysely trên handle đã tiêm và chạy `fn` trong
   * đó. Tiến trình chủ dùng phương thức này cho các luồng cần nguyên
   * tử (settle/refund) rồi truyền `tx` nhận được vào các repository
   * và service cùng tham gia — mọi lần ghi của luồng đó đi trên một
   * kết nối duy nhất, commit hoặc rollback cùng nhau.
   */
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

  /**
   * Ba con số đối soát tối giản, đếm ngay ở SQL bằng tổng có điều
   * kiện (`count(*) filter (...)`) trong MỘT truy vấn — khâu đối soát
   * không nạp toàn bộ bảng `payments` về tầng ứng dụng để đếm ở JS.
   * Điều kiện "chưa có mã giao dịch ngoài" giữ đúng ngữ nghĩa đếm cũ
   * ở tầng ứng dụng (giá trị falsy): `NULL` hoặc chuỗi rỗng đều tính.
   */
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
      .set({ ...mapPaymentInsert(patch), updated_at: new Date() })
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

  /** Tổng đã hoàn của một payment (cổng cộng dồn 5.5 — issue #189). */
  async sumRefunds(paymentId: string): Promise<number> {
    const row = await this.db
      .selectFrom('payment_refunds')
      .select(sql<number>`coalesce(sum(amount), 0)::int`.as('total'))
      .where('payment_id', '=', paymentId)
      .executeTakeFirst();
    return row?.total ?? 0;
  }

  // --- Vòng đời hoàn tiền (lát 3, issue #189) ------------------------------
  async getRefund(id: string, tx?: DbTx): Promise<RefundRow | undefined> {
    const db = tx ?? this.db;
    return db.selectFrom('payment_refunds').select(REFUND_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async updateRefund(id: string, patch: Partial<RefundInsert>, tx?: DbTx): Promise<RefundRow> {
    const db = tx ?? this.db;
    return db
      .updateTable('payment_refunds')
      .set({ ...mapRefundInsert(patch), updated_at: new Date() })
      .where('id', '=', id)
      .returning(REFUND_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Cập nhật một dòng hoàn CHỈ KHI trạng thái hiện tại của nó còn thuộc
   * `fromStatuses` — điều kiện trạng thái nằm ngay trong `WHERE` của
   * câu cập nhật nên hai lượt chuyển trạng thái song song không thể
   * cùng thắng: lượt sau khớp 0 dòng và nhận `undefined` (theo khuôn
   * kiểm-tra-rồi-ghi an toàn ở Read Committed — đọc trạng thái ở tầng
   * ứng dụng rồi cập nhật vô điều kiện theo `id` là dạng đua mà hai
   * người duyệt song song cùng qua cổng, người ghi sau thắng lặng lẽ).
   * Tầng service dịch `undefined` thành đúng mã lỗi trạng thái của
   * đường gọi đó. Dùng cho các khâu duyệt/từ chối (không có khoá dòng
   * bao ngoài); khâu xác nhận chi không dùng hàm này vì nó đã đọc lại
   * và quyết định dưới khoá `FOR UPDATE` của dòng khoản thu.
   */
  async updateRefundFromStatuses(
    id: string,
    fromStatuses: string[],
    patch: Partial<RefundInsert>,
    tx?: DbTx,
  ): Promise<RefundRow | undefined> {
    const db = tx ?? this.db;
    return db
      .updateTable('payment_refunds')
      .set({ ...mapRefundInsert(patch), updated_at: new Date() })
      .where('id', '=', id)
      .where('status', 'in', fromStatuses)
      .returning(REFUND_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Tổng cộng dồn của các dòng hoàn thuộc một TẬP TRẠNG THÁI cho trước.
   * Cổng cộng dồn dùng tập {requested, approved, settled} (mọi dòng
   * chưa bị từ chối đều giữ chỗ ngân sách hoàn); mốc đảo quyền lợi dùng
   * tập {settled} (chỉ tiền đã xác nhận chi mới tính tiền đã ra). Dòng
   * `rejected` không thuộc tập nào cả nên ngân sách được giải phóng.
   * Chạy trong transaction có khoá dòng `payments` khi gọi từ cổng tạo
   * yêu cầu hoàn / khâu xác nhận chi (truyền `tx`).
   */
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

  /**
   * Dòng hoàn ứng viên cho một sự kiện `debit`: đang `approved` (chờ xác
   * nhận chi), tài khoản của khoản thu gốc trùng tài khoản nhận sự
   * kiện, số tiền bằng nhau, và mã lệnh chi ghi trên dòng hoàn (mã dự
   * kiến lúc tạo) trùng mã giao dịch ngoài HOẶC mã tham chiếu của sự
   * kiện. Lấy dòng cũ nhất trước khi có nhiều dòng hoàn cùng chờ.
   */
  async findRefundCandidateForDebit(input: {
    accountId: string;
    amount: number;
    transactionIds: string[];
  }): Promise<{ refund: RefundRow; payment: PaymentRow } | undefined> {
    const ids = input.transactionIds.filter((v) => v.length > 0);
    if (ids.length === 0) return undefined;
    // Chỉ lấy hai id ứng viên ở câu truy vấn nối bảng (điều kiện khớp và thứ tự cũ nhất trước giữ nguyên), rồi đọc lại hai dòng đầy đủ bằng `getRefund`/`getPayment` — hai hàm này đã dùng `REFUND_COLUMNS`/`PAYMENT_COLUMNS` nên thêm một cột chỉ sửa một chỗ (danh sách cột), không còn alias viết tay với tiền tố `refund_`/`payment_` ở đây.
    // Đánh đổi có chủ đích: hai lần đọc lại không còn nằm trong cùng một snapshot với câu chọn ứng viên — dòng hoàn/khoản thu có thể đổi trạng thái (hoặc biến mất) trong khe giữa hai lần đọc thì hàm trả `undefined` và phía gọi coi như không khớp, đúng như khi câu chọn ban đầu khớp 0 dòng. Khâu xác nhận chi về sau vẫn đọc lại và quyết định dưới khoá dòng `payments` nên khe này không làm lọt quyết định chi sai.
    const candidate = await this.db
      .selectFrom('payment_refunds')
      .innerJoin('payments', 'payments.id', 'payment_refunds.payment_id')
      .select(['payment_refunds.id as refundId', 'payment_refunds.payment_id as paymentId'])
      .where('payment_refunds.status', '=', 'approved')
      .where('payments.account_id', '=', input.accountId)
      .where('payment_refunds.amount', '=', input.amount)
      .where('payment_refunds.external_transaction_id', 'in', ids)
      .orderBy('payment_refunds.created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (!candidate) return undefined;
    const [refund, payment] = await Promise.all([
      this.getRefund(candidate.refundId),
      this.getPayment(candidate.paymentId),
    ]);
    if (!refund || !payment) return undefined;
    return { refund, payment };
  }

  /** Dòng hoàn đã được xác nhận chi bởi chính sự kiện này — căn cứ idempotency khi sự kiện bị phát lại. */
  async getRefundBySettledEventId(eventId: string): Promise<RefundRow | undefined> {
    return this.db
      .selectFrom('payment_refunds')
      .select(REFUND_COLUMNS)
      .where('settled_event_id', '=', eventId)
      .executeTakeFirst();
  }

  // --- Hàng đợi needs_review (lát 3, issue #189) ---------------------------
  /** Mọi khoản thu đang chờ xử lý tay thuộc các tenant cho trước (phạm vi hàng đợi của người xem). */
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

  /**
   * Mọi sự kiện provider đang `needs_review` MÀ KHÔNG gắn khoản thu nào
   * (matched_payment_id rỗng) thuộc các tenant cho trước — đây là các
   * sự kiện "mồ côi" (mã lạ, debit không khớp dòng hoàn) cần xuất hiện
   * như mục độc lập trong hàng đợi. Sự kiện đã gắn khoản thu được trình
   * bày như ngữ cảnh của chính khoản thu đó, không thành mục riêng.
   */
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

  /**
   * Sự kiện provider liên quan gần nhất của một khoản thu: sự kiện đã
   * được gắn vào khoản thu (matched_payment_id) hoặc sự kiện mang mã
   * trích xuất trùng mã thanh toán của khoản thu — dùng làm ngữ cảnh
   * đối soát khi trình bày khoản chờ trong hàng đợi.
   */
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

  // --- VietQR / SePay (lát 1, issue #189) -----------------------------------
  /** Số thứ tự tiếp theo cho mã thanh toán — sequence chỉ tăng, mã không tái sử dụng. */
  async nextPaymentCodeValue(): Promise<number> {
    const result = await sql<{ v: number }>`select nextval('payment_code_seq')::int as v`.execute(this.db);
    return result.rows[0]!.v;
  }

  async getPaymentByCode(code: string): Promise<PaymentRow | undefined> {
    return this.db.selectFrom('payments').select(PAYMENT_COLUMNS).where('payment_code', '=', code).executeTakeFirst();
  }

  /** Tenant sở hữu một khoá — căn cứ cổng tenant cho createFeePayment (6.4.6). */
  async getCourseTenantId(courseId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('course')
      .select('tenant_id as tenantId')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.tenantId;
  }

  /** Định tuyến IPN: account theo `sepayBankAccountXid` trong config (định danh tổ chức SePay). */
  async findAccountBySepayXid(xid: string): Promise<AccountRow | undefined> {
    return this.db
      .selectFrom('payment_accounts')
      .select(ACCOUNT_COLUMNS)
      .where(sql<boolean>`"config"->>'sepayBankAccountXid' = ${xid}`)
      .executeTakeFirst();
  }

  /** Định tuyến IPN dự phòng: account theo số tài khoản ngân hàng trong config. */
  async findAccountByBankNumber(accountNumber: string): Promise<AccountRow | undefined> {
    return this.db
      .selectFrom('payment_accounts')
      .select(ACCOUNT_COLUMNS)
      .where(sql<boolean>`"config"->>'bankAccountNumber' = ${accountNumber}`)
      .executeTakeFirst();
  }

  /**
   * Ghi sự kiện kênh: unique (provider, external_transaction_id) là cổng
   * idempotency — bản ghi trùng (SePay retry) trả `undefined`, không ghi hai lần.
   */
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

  /** Sự kiện đang chờ matching: `received`, cộng `processing` treo quá lâu (tiến trình chết giữa chừng). */
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

  /**
   * Nhận việc một sự kiện: đổi trạng thái khớp sang `processing` khi
   * sự kiện còn ở `received` hoặc đã ở `processing` (nhận lại
   * idempotent của cùng nhịp quét); trả false chỉ khi sự kiện đã
   * sang trạng thái khớp khác.
   */
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
      .set(mapProviderEventInsert(patch))
      .where('id', '=', id)
      .execute();
  }

  // --- Quyền lợi gói (lát 2, issue #189) ------------------------------------
  async insertEntitlement(input: EntitlementInsert): Promise<EntitlementRow> {
    return this.db
      .insertInto('plan_entitlements')
      .values(mapEntitlementInsert(input))
      .returning(ENTITLEMENT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Quyền lợi sinh từ một payment gói — căn cứ idempotency của khâu kích hoạt. */
  async getEntitlementByPayment(paymentId: string): Promise<EntitlementRow | undefined> {
    return this.db
      .selectFrom('plan_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .where('payment_id', '=', paymentId)
      .executeTakeFirst();
  }

  /**
   * Mốc hết hạn muộn nhất trong các quyền lợi đang `active` của cùng một
   * bên hưởng + cùng loại gói — căn cứ nối tiếp cửa sổ khi mua tiếp.
   * Bên hưởng của `tenant_plan` xác định bằng (tenant_id, user_id NULL);
   * của `teacher_plan` bằng user_id.
   */
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

  /** Mọi quyền lợi gói giáo viên của một người dùng (theo thứ tự bắt đầu tăng dần). */
  async listEntitlementsForUser(userId: string): Promise<EntitlementRow[]> {
    return this.db
      .selectFrom('plan_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('starts_at', 'asc')
      .execute();
  }

  /** Mọi quyền lợi gói trung tâm của một tenant (theo thứ tự bắt đầu tăng dần). */
  async listTenantPlanEntitlements(tenantId: string): Promise<EntitlementRow[]> {
    return this.db
      .selectFrom('plan_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('user_id', 'is', null)
      .orderBy('starts_at', 'asc')
      .execute();
  }

  /** Đảo quyền lợi khi hoàn đủ: quyền lợi của chính payment chuyển `suspended`. */
  async suspendEntitlementsByPayment(paymentId: string, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .updateTable('plan_entitlements')
      .set({ status: 'suspended', updated_at: new Date() })
      .where('payment_id', '=', paymentId)
      .execute();
  }

  // --- Coupon giảm giá mua gói (phần còn lại của lát 2, issue #189) --------
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

  /** Tra coupon theo mã đã chuẩn hoá chữ hoa (mã là duy nhất toàn hệ). */
  async getCouponByCode(code: string): Promise<CouponRow | undefined> {
    return this.db.selectFrom('payment_coupons').select(COUPON_COLUMNS).where('code', '=', code).executeTakeFirst();
  }

  async listCoupons(): Promise<CouponRow[]> {
    return this.db.selectFrom('payment_coupons').select(COUPON_COLUMNS).orderBy('created_at', 'asc').execute();
  }

  async updateCoupon(id: string, patch: Partial<CouponInsert>): Promise<CouponRow> {
    return this.db
      .updateTable('payment_coupons')
      .set({ ...mapCouponInsert(patch), updated_at: new Date() })
      .where('id', '=', id)
      .returning(COUPON_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Số lượt dùng đã tiêu thụ của một coupon: số payment gói mang
   * coupon này trong ảnh chụp `data.plan` và đang ở trạng thái
   * `pending` hoặc `succeeded` — payment `failed` không tính (lượt
   * dùng được hoàn lại), đúng đặc tả coupon của issue.
   */
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
