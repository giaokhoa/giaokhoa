export { default } from './content-bank-edit';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { platformKeyMeta } from '#lib/route-meta';
export function meta() {
  return platformKeyMeta('libraryFormTitleNew');
}
