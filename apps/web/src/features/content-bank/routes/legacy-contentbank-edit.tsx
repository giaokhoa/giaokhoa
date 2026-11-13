import { replace } from 'react-router';
import type { Route } from './+types/legacy-contentbank-edit';
import { LegacyContentBankEditRedirect } from '../components/legacy-content-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyContentBankEditRedirect;

export function loader({ request, params }: Route.LoaderArgs) {
  return replace(`/content-bank/${params.id}/edit${new URL(request.url).search}`);
}
