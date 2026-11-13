/**
 * Route tương thích `legacy-matrix-edit`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import type { Route } from './+types/legacy-matrix-edit';
import { LegacyMatrixEditRedirect } from '#features/questions/components/legacy-bank-redirects';

// Lớp tương thích (chuẩn đường dẫn #221, mục 3.5): path cũ /questions/matrices/:matrixId/edit chuyển hướng thay thế sang /matrices/:matrixId/edit, giữ nguyên định danh ma trận.
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyMatrixEditRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader({ params }: Route.LoaderArgs) {
  return replace(`/matrices/${params.matrixId}/edit`);
}
