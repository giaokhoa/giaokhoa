import { replace } from 'react-router';

export function loader() {
  return replace('/settings/security');
}

export function SettingsIndexPage() {
  return null;
}

export default SettingsIndexPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navSettings');
}
