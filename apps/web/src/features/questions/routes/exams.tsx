import { QuestionsPage } from '../components/questions';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navMyPapers');
}

export default function ExamsRoute() {
  return <QuestionsPage area="my-exams" />;
}

export { questionsPageClientLoader as clientLoader } from '../queries/questions';
