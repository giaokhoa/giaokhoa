import { replace } from 'react-router';
import { LegacyMatrixNewRedirect } from '#features/questions/components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyMatrixNewRedirect;

export function loader() {
  return replace('/matrices/new');
}
