/**
 * Route tương thích `system-bank`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import { SystemBankIndexRedirect } from '../components/legacy-bank-redirects';

// Gốc khu hệ thống (/system-bank — chuẩn đường dẫn #221):
// không có trang riêng, tự chuyển hướng tới Ngân hàng câu hỏi — tab Hệ thống.
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navQuestions');
}

export default SystemBankIndexRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader() {
  return replace('/system-bank/questions');
}
