/** Module route tương thích legacy-quiz-results: loader chuyển URL cũ bằng HTTP 302, giữ mặc định component làm dự phòng. */
import LegacyQuizRedirect, { legacyQuizLoader } from './legacy-quiz-redirect';
import type { Route } from './+types/legacy-quiz-results';

// Lớp tương thích sau gộp Đề (#226): path cũ /courses/:id/quizzes/:quizId (kể cả hậu tố results/paper) chuyển hướng thay thế sang /courses/:id/exams/:quizId cùng hậu tố. Mỗi route một file riêng vì React Router suy id route từ đường dẫn file.
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyQuizRedirect;

/** Chuyển URL cũ tại tầng loader để cả request SSR và navigation phía client đều nhận redirect. */
export function loader({ request }: Route.LoaderArgs) {
  return legacyQuizLoader(request);
}
