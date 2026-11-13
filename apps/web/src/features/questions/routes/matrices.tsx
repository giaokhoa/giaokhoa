import { QuestionsPage } from '../components/questions';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navMyMatrices');
}

export default function MatricesRoute() {
  return <QuestionsPage area="my-matrices" />;
}

export { questionsPageClientLoader as clientLoader } from '../queries/questions';
