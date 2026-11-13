import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { tenantAls } from './tenant-als';

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

  private prepareClient(client: PoolClient): PoolClient {
    const store = tenantAls.getStore();
    const tenantId = store?.platform ? '' : (store?.tenantId ?? '');
    const platform = store?.platform ? 'on' : 'off';
    const holder = client as PoolClient & { [TAG_STATE]?: TenantTagState };
    const existing = holder[TAG_STATE];
    if (existing) {
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
