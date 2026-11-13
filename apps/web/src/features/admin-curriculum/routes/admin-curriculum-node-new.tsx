export { AdminNodeNewPage as default } from '../components/node-pages';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo nút chương trình');
}
