import { replace } from 'react-router';
import type { Route } from './+types/legacy-matrix-edit';
import { LegacyMatrixEditRedirect } from '#features/questions/components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyMatrixEditRedirect;

export function loader({ params }: Route.LoaderArgs) {
  return replace(`/matrices/${params.matrixId}/edit`);
}
