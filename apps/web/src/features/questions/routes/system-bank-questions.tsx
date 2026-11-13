import { QuestionsPage } from '../components/questions';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navQuestions');
}

export default function SystemBankQuestionsRoute() {
  return <QuestionsPage area="system-questions" />;
}

export { questionsPageClientLoader as clientLoader } from '../queries/questions';
