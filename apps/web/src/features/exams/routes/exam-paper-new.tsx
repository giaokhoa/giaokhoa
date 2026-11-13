/**
 * Route module mỏng: màn tạo đề mới — dùng lại màn soạn đề (`ExamPaperNewPage` trong `exam-paper-editor`, cùng component soạn với màn sửa, chế độ suy từ việc có paperId trên đường dẫn hay không) và chỉ giữ tiêu đề riêng của màn tạo.
 */
export { ExamPaperNewPage as default } from './exam-paper-editor';

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo đề');
}
