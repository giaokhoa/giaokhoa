/**
 * Lối import tương thích cho các feature đã sử dụng tên tenant-als cũ.
 * Nguồn ngữ cảnh AsyncLocalStorage duy nhất nằm ở tầng db, dùng chung
 * cho guard, service, job và pool; không tạo instance khác.
 */
export { tenantAls, type TenantAlsStore } from '../../db/tenant-als';
