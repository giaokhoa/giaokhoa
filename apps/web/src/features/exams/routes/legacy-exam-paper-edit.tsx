import { replace } from 'react-router';
import type { Route } from './+types/legacy-exam-paper-edit';
import { LegacyExamPaperEditRedirect } from '#features/questions/components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyExamPaperEditRedirect;

export function loader({ request, params }: Route.LoaderArgs) {
  return replace(`/exams/${params.paperId}/edit${new URL(request.url).search}`);
}
