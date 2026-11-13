import { replace } from 'react-router';
import { SystemBankIndexRedirect } from '../components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navQuestions');
}

export default SystemBankIndexRedirect;

export function loader() {
  return replace('/system-bank/questions');
}
