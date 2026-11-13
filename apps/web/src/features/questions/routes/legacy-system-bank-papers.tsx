/**
 * Route tương thích `legacy-system-bank-papers`: khi Framework Mode nhận request, loader
 * trả HTTP 302 tới URL chuẩn, giữ trạng thái replace lúc navigation.
 * Component hiện hữu là fallback cho các bài test chỉ render UI.
 */
import { replace } from 'react-router';
import { LegacySystemBankPapersRedirect } from '../components/legacy-bank-redirects';

// Lớp tương thích: path /system-bank/papers (dạng trung gian trong lát R1) chuyển hướng thay thế sang /system-bank/exams — tên tài nguyên chốt là "exams" (quyết định tối 25/10/2026).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacySystemBankPapersRedirect;

/** Trả redirect HTTP, thực thi trước khi render component route. */
export function loader() {
  return replace('/system-bank/exams');
}
