import { replace } from 'react-router';
import { LegacySystemBankPapersRedirect } from '../components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export default LegacySystemBankPapersRedirect;

export function loader() {
  return replace('/system-bank/exams');
}
