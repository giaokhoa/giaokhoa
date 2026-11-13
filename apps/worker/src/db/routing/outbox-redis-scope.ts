import { tenantAls } from '../tenant-als';

export function scopedOutboxId(outboxId: string): string {
  const spaceId = tenantAls.getStore()?.spaceId;
  return spaceId ? `${spaceId}-${outboxId}` : outboxId;
}
