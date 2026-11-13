export { QuestionUsagePage as default } from '../components/usage-page';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Mức sử dụng câu hỏi');
}
