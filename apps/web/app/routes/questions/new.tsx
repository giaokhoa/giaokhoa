import { requireSession } from '#features/auth/api/session.server.js';
import { QuestionAuthoring } from '#features/questions/authoring/question-authoring.js';
import { createQuestionDraft } from '#features/questions/authoring/draft-state.js';
import { saveQuestionAction } from '#features/questions/authoring/save-action.server.js';
import type { Route } from './+types/new';

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);
  return { initialDraft: createQuestionDraft('multiple_choice') };
}

export async function action({ request }: Route.ActionArgs) {
  return saveQuestionAction(request);
}

export default function NewQuestion({ loaderData }: Route.ComponentProps) {
  return <QuestionAuthoring initialDraft={loaderData.initialDraft} />;
}
