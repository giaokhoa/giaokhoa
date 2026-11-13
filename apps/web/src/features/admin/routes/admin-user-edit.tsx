export { AdminUserEditPage as default } from '../components/admin-users';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Sửa người dùng');
}
