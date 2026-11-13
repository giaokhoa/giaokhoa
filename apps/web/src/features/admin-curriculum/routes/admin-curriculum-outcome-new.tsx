export { AdminOutcomeNewPage as default } from '../components/outcome-pages';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo chuẩn đầu ra');
}
