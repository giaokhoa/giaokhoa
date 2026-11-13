import { replace } from 'react-router';

/**
 * Route gốc `/settings` không có nội dung: loader chuyển thẳng tới
 * màn Bảo mật bằng HTTP 302, giữ ngữ nghĩa thay thế entry lịch sử khi
 * điều hướng phía client. Redirect ở loader còn hoạt động trước hydrate
 * khi người dùng truy cập URL này trực tiếp bằng SSR.
 */
export function loader() {
  return replace('/settings/security');
}

/** Framework route cần component mặc định, nhưng loader luôn chuyển hướng trước khi render. */
export function SettingsIndexPage() {
  return null;
}

export default SettingsIndexPage;

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navSettings');
}
