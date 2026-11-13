import { Injectable } from '@nestjs/common';
import { sql as kyselySql, type CentreTx } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls, type TenantAlsStore } from './tenant-als';
import { TenantContextService } from './tenant-context.service';


@Injectable()
export class TenantDbService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}

  async runInTenantContext<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.runInContext(
      { tenantId, userId: this.tenantContext.currentUserId(), platform: false },
      fn,
    );
  }

  async runInPlatformContext<T>(fn: () => Promise<T>): Promise<T> {
    return this.runInContext({ userId: this.tenantContext.currentUserId(), platform: true }, fn);
  }

  async withTenant<T>(tenantId: string, fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.runInContext({ tenantId, userId: this.tenantContext.currentUserId(), platform: false }, () =>
      this.spaceDb.routedKysely.transaction().execute(async (trx) => {
        await kyselySql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
        await kyselySql`select set_config('app.platform', 'off', true)`.execute(trx);
        return fn(trx);
      }),
    );
  }

  async withPlatform<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.runInContext({ userId: this.tenantContext.currentUserId(), platform: true }, () =>
      this.spaceDb.routedKysely.transaction().execute(async (trx) => {
        await kyselySql`select set_config('app.platform', 'on', true)`.execute(trx);
        return fn(trx);
      }),
    );
  }

  async withCurrent<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    if (this.tenantContext.isPlatformContext()) return this.withPlatform(fn);
    const tenantId = this.tenantContext.currentTenantId();
    if (tenantId) return this.withTenant(tenantId, fn);
    return this.spaceDb.routedKysely.transaction().execute(fn);
  }

  private runInContext<T>(store: TenantAlsStore, fn: () => Promise<T>): Promise<T> {
    const parent = tenantAls.getStore();
    return tenantAls.run({ ...parent, ...store }, fn);
  }
}
