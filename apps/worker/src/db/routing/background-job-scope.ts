/**
 * Miền phát sinh job trực tiếp từ API: worker luôn kiểm lại slug và
 * định danh bất biến trong sổ trước khi handler đọc/ghi database.
 * Các trường optional để giữ khả năng giải mã job legacy kho chung;
 * job kho riêng không có spaceId bị SpaceJobRunner từ chối.
 */
export interface BackgroundJobScope {
  spaceSlug?: string | null;
  spaceId?: string | null;
  tenantId?: string | null;
}
