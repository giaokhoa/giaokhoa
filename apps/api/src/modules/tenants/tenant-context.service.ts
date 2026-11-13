import { Injectable } from '@nestjs/common';
import { tenantAls, type TenantAlsStore } from './tenant-als';

export type TenantRequestContext = TenantAlsStore;

@Injectable()
export class TenantContextService {
  run<T>(ctx: TenantRequestContext, fn: () => T): T {
    return tenantAls.run(ctx, fn);
  }

  enter(ctx: TenantRequestContext): void {
    tenantAls.enterWith(ctx);
  }

  currentTenantId(): string | undefined {
    return tenantAls.getStore()?.tenantId;
  }

  currentUserId(): string | undefined {
    return tenantAls.getStore()?.userId;
  }

  isPlatformContext(): boolean {
    return tenantAls.getStore()?.platform === true;
  }
}
