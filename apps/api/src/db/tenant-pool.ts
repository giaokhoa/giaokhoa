import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { tenantAls } from '../modules/tenants/tenant-als';

/**
 * Pool PostgreSQL gắn ngữ cảnh tenant từ `tenantAls` vào mọi kết nối ngay trước truy vấn đầu tiên sau mỗi lượt checkout.
 *
 * Vì truy vấn Kysely có thể chạy ngoài transaction tường minh, GUC dùng `set_config(..., false)` ở mức phiên. Ngữ cảnh tenant đặt `app.tenant_id` và `app.platform = 'off'`; ngữ cảnh platform đặt `app.platform = 'on'`; không có ngữ cảnh thì đặt tenant rỗng và platform tắt để RLS từ chối dữ liệu tenant.
 *
 * Khi pool tái sử dụng một client, trạng thái `tagged` được đặt lại để GUC từ request trước không rò sang request sau. Transaction cũng checkout qua pool này; `set_config(..., true)` trong transaction có thể ghi đè GUC ở phạm vi giao dịch khi cần.
 */
interface TenantTagState {
  tagged: boolean;
  tenantId: string;
  platform: string;
  rawQuery: (...args: unknown[]) => Promise<unknown>;
}

const TAG_STATE = Symbol('tenantTagState');

export class TenantAwarePool extends Pool {
  constructor(config: PoolConfig) {
    super(config);
  }

  /** Chuẩn bị state gắn GUC cho một client vừa checkout theo ngữ cảnh ALS hiện tại. */
  private prepareClient(client: PoolClient): PoolClient {
    const store = tenantAls.getStore();
    const tenantId = store?.platform ? '' : (store?.tenantId ?? '');
    const platform = store?.platform ? 'on' : 'off';
    const holder = client as PoolClient & { [TAG_STATE]?: TenantTagState };
    const existing = holder[TAG_STATE];
    if (existing) {
      // Client tái sử dụng từ pool: cập nhật đích GUC + buộc gắn lại ở
      // câu truy vấn đầu tiên của lượt checkout này.
      existing.tenantId = tenantId;
      existing.platform = platform;
      existing.tagged = false;
      return client;
    }
    const state: TenantTagState = {
      tagged: false,
      tenantId,
      platform,
      rawQuery: client.query.bind(client) as (...args: unknown[]) => Promise<unknown>,
    };
    holder[TAG_STATE] = state;
    client.query = (async (...args: unknown[]) => {
      if (!state.tagged) {
        await state.rawQuery(
          "select set_config('app.tenant_id', $1, false), set_config('app.platform', $2, false)",
          [state.tenantId, state.platform],
        );
        state.tagged = true;
      }
      return state.rawQuery(...args);
    }) as PoolClient['query'];
    return client;
  }

  override connect(): Promise<PoolClient>;
  override connect(
    callback: (err: Error, client: PoolClient, done: (release?: unknown) => void) => void,
  ): void;
  override connect(
    callback?: (err: Error, client: PoolClient, done: (release?: unknown) => void) => void,
  ): Promise<PoolClient> | void {
    if (callback) {
      // Dạng callback (pg dùng nội bộ cho pool.query): giữ nguyên hợp
      // đồng — client trao tay đã sẵn sàng gắn GUC ở câu query đầu.
      super.connect((err, client, done) => {
        if (err || !client)
          return callback(
            err ?? new Error('TenantAwarePool: connect failed'),
            client as PoolClient,
            done,
          );
        try {
          this.prepareClient(client);
        } catch (prepError) {
          done(prepError);
          return callback(prepError as Error, client, done);
        }
        return callback(null as unknown as Error, client, done);
      });
      return undefined;
    }
    return super.connect().then((client) => this.prepareClient(client));
  }
}
