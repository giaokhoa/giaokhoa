export { QuestionCategoryNewPage as default } from '../components/category-new-page';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo danh mục câu hỏi');
}
