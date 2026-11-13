import { replace } from 'react-router';
import type { Route } from './+types/legacy-exam-paper-new';
import { LegacyExamPaperNewRedirect } from '#features/questions/components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyExamPaperNewRedirect;

export function loader({ request }: Route.LoaderArgs) {
  return replace('/exams/new' + new URL(request.url).search);
}
