import { tenantAls } from '../../modules/tenants/tenant-als';

/**
 * Phong bì truyền miền của một job từ API sang worker. Mọi trường
 * đều xuất phát từ ALS đã được guard/withSpaceKysely xác thực;
 * không nhận slug hoặc id kho từ body của client.
 */
export interface BackgroundJobContext {
  spaceSlug: string | null;
  spaceId: string | null;
  tenantId: string | null;
}

/**
 * Đọc ngữ cảnh đã xác thực tại lúc enqueue. Job không mang slug
 * thuộc kho chung nên không được lén mang một tenantId như thể đã
 * nhận diện một kho riêng. Worker sẽ kiểm lại sổ khi xử lý/retry.
 */
export function backgroundJobContext(): BackgroundJobContext {
  const store = tenantAls.getStore();
  return {
    spaceSlug: store?.spaceSlug ?? null,
    spaceId: store?.spaceId ?? null,
    tenantId: store?.spaceSlug ? (store.tenantId ?? null) : null,
  };
}

/**
 * BullMQ dùng một Redis cho mọi kho nên jobId cũng mang danh tính
 * kho, không chỉ ID của một bản ghi nghiệp vụ.
 *
 * @param businessId Phần định danh nghiệp vụ không chứa dấu `:`.
 */
export function backgroundJobId(businessId: string): string {
  return `${tenantAls.getStore()?.spaceId ?? 'shared'}-${businessId}`;
}
