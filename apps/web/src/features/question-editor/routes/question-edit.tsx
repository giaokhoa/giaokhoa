/**
 * Route module mỏng: màn sửa câu hỏi — dùng lại màn soạn câu hỏi (`QuestionEditPage` trong `question-editor`, cùng component soạn với màn tạo, chế độ suy từ việc có questionId trên đường dẫn hay không) và chỉ giữ tiêu đề riêng của màn sửa.
 */
export { QuestionEditPage as default } from './question-editor';

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Sửa câu hỏi');
}
