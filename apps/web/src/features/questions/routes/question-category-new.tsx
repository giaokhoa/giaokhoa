/**
 * Route module mỏng: màn tạo danh mục câu hỏi — dùng lại `QuestionCategoryNewPage` (`category-new-page`) và chỉ giữ tiêu đề riêng của màn tạo.
 */
export { QuestionCategoryNewPage as default } from '../components/category-new-page';

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo danh mục câu hỏi');
}
