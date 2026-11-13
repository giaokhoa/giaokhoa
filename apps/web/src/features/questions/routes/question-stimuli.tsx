import { QuestionsPage } from '../components/questions';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Ngữ liệu');
}

export default function QuestionStimuliRoute() {
  return <QuestionsPage area="stimuli" />;
}

export { questionsPageClientLoader as clientLoader } from '../queries/questions';
