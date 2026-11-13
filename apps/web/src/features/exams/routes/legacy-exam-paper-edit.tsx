/**
 * Route tương thích `legacy-exam-paper-edit`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import type { Route } from './+types/legacy-exam-paper-edit';
import { LegacyExamPaperEditRedirect } from '#features/questions/components/legacy-bank-redirects';

// Lớp tương thích: path cũ /exam-papers/:paperId/edit chuyển hướng thay thế sang /exams/:paperId/edit, giữ nguyên định danh đề.
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyExamPaperEditRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader({ request, params }: Route.LoaderArgs) {
  return replace(`/exams/${params.paperId}/edit${new URL(request.url).search}`);
}
