import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantAlsStore {
  tenantId?: string;
  userId?: string;
  spaceSlug?: string;
  spaceId?: string;
  spaceHandle?: object;
  platform?: boolean;
}

export const tenantAls = new AsyncLocalStorage<TenantAlsStore>();
