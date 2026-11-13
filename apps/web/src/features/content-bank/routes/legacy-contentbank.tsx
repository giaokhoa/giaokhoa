import { replace } from 'react-router';
import type { Route } from './+types/legacy-contentbank';
import { LegacyContentBankRedirect } from '../components/legacy-content-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacyContentBankRedirect;

export function loader({ request }: Route.LoaderArgs) {
  return replace('/content-bank' + new URL(request.url).search);
}
