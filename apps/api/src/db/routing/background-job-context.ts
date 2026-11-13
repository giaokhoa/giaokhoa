import { tenantAls } from '../../modules/tenants/tenant-als';

export interface BackgroundJobContext {
  spaceSlug: string | null;
  spaceId: string | null;
  tenantId: string | null;
}

export function backgroundJobContext(): BackgroundJobContext {
  const store = tenantAls.getStore();
  return {
    spaceSlug: store?.spaceSlug ?? null,
    spaceId: store?.spaceId ?? null,
    tenantId: store?.spaceSlug ? (store.tenantId ?? null) : null,
  };
}

export function backgroundJobId(businessId: string): string {
  return `${tenantAls.getStore()?.spaceId ?? 'shared'}-${businessId}`;
}
