import { type RouteConfig, relative } from '@react-router/dev/routes';

const { index, prefix, route } = relative(import.meta.dirname);

/**
 * Khu route của feature classes — Lớp học (CLASS-1, issue #184):
 * danh sách/tạo màn riêng, tự báo danh, chi tiết lớp (roster) và sửa lớp — URL tĩnh `new`/`join` được router ưu tiên hơn `:id` qua cơ chế xếp hạng route; trang công khai mua gói học phí của lớp (CLASS-3, issue #184) là route ':id/public'.
 */
export default prefix('classes', [
  index('routes/classes.tsx'),
  route('new', 'routes/class-new.tsx'),
  route('join', 'routes/class-join.tsx'),
  route(':id', 'routes/class-detail.tsx'),
  route(':id/edit', 'routes/class-edit.tsx'),
  route(':id/public', 'routes/class-public.tsx'),
]) satisfies RouteConfig;
