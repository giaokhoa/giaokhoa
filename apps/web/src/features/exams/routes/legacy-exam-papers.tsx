/**
 * Route tương thích `legacy-exam-papers`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import type { Route } from './+types/legacy-exam-papers';
import { LegacyExamPapersRedirect } from '#features/questions/components/legacy-bank-redirects';

// Lớp tương thích (chuẩn đường dẫn #221 + chốt tên "exams" tối 25/10/2026): path cũ /exam-papers chuyển hướng thay thế sang /exams.
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyExamPapersRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader({ request }: Route.LoaderArgs) {
  return replace('/exams' + new URL(request.url).search);
}
