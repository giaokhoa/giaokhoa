/**
 * Route tương thích `legacy-contentbank-new`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import type { Route } from './+types/legacy-contentbank-new';
import { LegacyContentBankNewRedirect } from '../components/legacy-content-bank-redirects';

// Lớp tương thích (chuẩn đường dẫn #221, lát R3): path cũ viết dính /contentbank/new chuyển hướng thay thế sang /content-bank/new.
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyContentBankNewRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader({ request }: Route.LoaderArgs) {
  return replace('/content-bank/new' + new URL(request.url).search);
}
