import LegacyQuizRedirect, { legacyQuizLoader } from './legacy-quiz-redirect';
import type { Route } from './+types/legacy-quiz-paper';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyQuizRedirect;

export function loader({ request }: Route.LoaderArgs) {
  return legacyQuizLoader(request);
}
