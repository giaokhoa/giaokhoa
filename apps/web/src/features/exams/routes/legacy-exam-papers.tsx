import { replace } from 'react-router';
import type { Route } from './+types/legacy-exam-papers';
import { LegacyExamPapersRedirect } from '#features/questions/components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyExamPapersRedirect;

export function loader({ request }: Route.LoaderArgs) {
  return replace('/exams' + new URL(request.url).search);
}
