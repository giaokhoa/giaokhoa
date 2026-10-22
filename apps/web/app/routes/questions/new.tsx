import { requireCapability } from '#features/workspace/access.server.js';
import { QuestionAuthoring } from '#features/questions/authoring/question-authoring.js';
import { createQuestionDraft } from '#features/questions/authoring/draft-state.js';
import { saveQuestionAction } from '#features/questions/authoring/save-action.server.js';
import type { Route } from './+types/new';

export async function loader({ request }: Route.LoaderArgs) {
  await requireCapability(request, 'question:create_own');
  return { initialDraft: createQuestionDraft('multiple_choice') };
}

export async function action({ request }: Route.ActionArgs) {
  return saveQuestionAction(request);
}

export default function NewQuestion({ loaderData }: Route.ComponentProps) {
  return <QuestionAuthoring initialDraft={loaderData.initialDraft} />;
}

export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
