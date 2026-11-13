import { Navigate, useLocation } from 'react-router';
import { appKeyMeta } from '#lib/route-meta';
import { QuestionsPage } from '../components/questions';
import { legacyQuestionsTarget } from '../components/legacy-bank-redirects';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

export function meta() {
  return appKeyMeta('navQuestions');
}

export default function QuestionsRoute() {
  const location = useLocation();
  const target = legacyQuestionsTarget(location.search);
  if (target) return <Navigate to={target} replace />;
  return <QuestionsPage area="my-questions" />;
}

export { questionsPageClientLoader as clientLoader } from '../queries/questions';
