import { Injectable } from '@nestjs/common';
import { sql, type CentreDb, type CentreDB, type CentreTx } from '@giaokhoa/db';
import { tenantAls } from '../../modules/tenants/tenant-als';

export interface OutboxEventInput {
  aggregate: string;
  type: string;
  payload: Record<string, unknown>;
  /** Tenant của ngữ cảnh phát sinh sự kiện (TENANT-0, #168); bỏ trống = platform/không gian chung. */
  tenantId?: string | null;
}

/**
 * Ghi sự kiện outbox trong cùng transaction với thay đổi nghiệp vụ: rollback phải xoá cả dữ liệu lẫn sự kiện, để relay không phát một sự kiện chưa commit.
 *
 * `enqueueKysely` nhận transaction của phía gọi; `enqueueStandalone` tự mở một transaction ngắn trên handle hiệu lực. Nếu service hoạt động trong kho riêng, `resolveStandaloneDb` chuẩn bị và phân giải handle theo slug trước khi ghi; các runner đã có handle đích có thể không cần bộ phân giải.
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly db: CentreDb,
    private readonly resolveStandaloneDb?: () => Promise<CentreDb>,
  ) {}

  /**
   * Phân giải tenant hiệu lực và payload của một sự kiện — nhà duy nhất của luật này cho MỌI đường ghi outbox (trong transaction của phía gọi và standalone), để các đường không bao giờ lệch nhau.
   *
   * TENANT-1 (#196): tenant hiệu lực mặc định lấy từ ngữ cảnh ALS của luồng phát sinh (request tenant / job đã bọc) khi nơi gọi không chỉ định tường minh; tenant cũng được GƯƠNG vào payload để các consumer chạy ở ngữ cảnh platform (relay, consumer thông báo/digest) biết sự kiện thuộc tenant nào mà gắn đúng tenant cho dữ liệu chúng tạo ra.
   */
  private resolveTenantPayload(input: OutboxEventInput): { tenantId: string | null; payload: Record<string, unknown> } {
    const tenantId = input.tenantId ?? tenantAls.getStore()?.tenantId ?? null;
    const payload = tenantId && input.payload['tenantId'] === undefined
      ? { ...input.payload, tenantId }
      : input.payload;
    return { tenantId, payload };
  }

  /**
   * Ghi outbox qua transaction Kysely của phía gọi, bảo đảm dữ liệu nghiệp vụ và sự kiện commit/rollback cùng nhau.
   *
   * Payload JSONB được `JSON.stringify` và ép `::jsonb` vì driver `pg` có thể hiểu mảng cấp cao nhất là mảng PostgreSQL thay vì JSON.
   */
  async enqueueKysely(tx: CentreTx, input: OutboxEventInput): Promise<void> {
    const { tenantId, payload } = this.resolveTenantPayload(input);
    await tx
      .insertInto('outbox_events')
      .values({
        aggregate: input.aggregate,
        type: input.type,
        payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify(payload)}::jsonb`,
        tenant_id: tenantId,
      })
      .execute();
  }

  /**
   * Hàm tiện ích: đưa vào hàng đợi trong một transaction Kysely
   * ngắn riêng. Handle đích lấy qua hàm phân giải standalone khi
   * tầng wiring có cấp (xem TSDoc của lớp — ngữ cảnh mang slug của
   * trung tâm kho riêng chưa chuẩn bị cần được chuẩn bị trước),
   * không thì dùng thẳng handle của service.
   */
  async enqueueStandalone(input: OutboxEventInput): Promise<void> {
    const db = this.resolveStandaloneDb ? await this.resolveStandaloneDb() : this.db;
    await db.transaction().execute(async (tx) => {
      await this.enqueueKysely(tx, input);
    });
  }
}
