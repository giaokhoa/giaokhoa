/**
 * Khoá chống trùng của outbox: cùng UUID có thể xuất hiện ở hai kho
 * trung tâm khác nhau vì mỗi database tự sinh định danh. Phạm vi
 * được lấy từ phiên đã được SpaceJobRunner kiểm chứng, không đọc
 * từ payload tùy ý của người gửi.
 */
import { tenantAls } from '../tenant-als';

/**
 * @param outboxId Định danh một dòng trong đúng kho của phiên.
 * @returns Định danh dành cho Redis, giữ tương thích kho chung cũ.
 */
export function scopedOutboxId(outboxId: string): string {
  const spaceId = tenantAls.getStore()?.spaceId;
  return spaceId ? `${spaceId}-${outboxId}` : outboxId;
}
