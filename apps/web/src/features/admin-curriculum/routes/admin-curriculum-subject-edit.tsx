export { AdminSubjectEditPage as default } from '../components/subject-pages';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Sửa môn học');
}
