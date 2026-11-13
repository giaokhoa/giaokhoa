export { AdminCurriculumNewPage as default } from '../components/curriculum-form-pages';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo chương trình');
}
