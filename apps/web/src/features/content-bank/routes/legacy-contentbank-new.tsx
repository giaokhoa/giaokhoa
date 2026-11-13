import { replace } from 'react-router';
import type { Route } from './+types/legacy-contentbank-new';
import { LegacyContentBankNewRedirect } from '../components/legacy-content-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyContentBankNewRedirect;

export function loader({ request }: Route.LoaderArgs) {
  return replace('/content-bank/new' + new URL(request.url).search);
}
