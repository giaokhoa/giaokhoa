/**
 * Giá trị `kind` của tenant trung tâm dùng trong dữ liệu gieo của spec
 * (S15): cách viết chuẩn là `'center'` — khớp `TENANT_KINDS` trong
 * `@giaokhoa/contracts` (`tenants.ts`: `'school' | 'center' |
 * 'platform'`) và mọi code production. Cách viết `'centre'` là lỗi
 * chính tả rò từ tên kho/thư mục migration (`centre`) sang trường
 * `kind`, không có code production nào sinh ra — spec gieo `'centre'`
 * là đang gieo dữ liệu mà production không bao giờ tạo.
 */
export const TEST_TENANT_KIND = 'center' as const;
