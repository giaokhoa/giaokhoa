/**
 * Route module mỏng: màn tạo câu hỏi — dùng lại màn soạn câu hỏi (`QuestionNewPage` trong `question-editor`, cùng component soạn với màn sửa) và chỉ giữ tiêu đề riêng của màn tạo.
 */
export { QuestionNewPage as default } from './question-editor';

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo câu hỏi');
}
