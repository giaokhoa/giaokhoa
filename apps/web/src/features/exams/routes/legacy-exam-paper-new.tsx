/**
 * Route tương thích `legacy-exam-paper-new`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import type { Route } from './+types/legacy-exam-paper-new';
import { LegacyExamPaperNewRedirect } from '#features/questions/components/legacy-bank-redirects';

// Lớp tương thích: path cũ /exam-papers/new chuyển hướng thay thế sang /exams/new, giữ query prefill (vd ?bank=).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyExamPaperNewRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader({ request }: Route.LoaderArgs) {
  return replace('/exams/new' + new URL(request.url).search);
}
