import { questionsContract } from '@giaokhoa/shared/http/questions';
import { requireCapability } from '#features/workspace/access.server.js';
import { QuestionAuthoring } from '#features/questions/authoring/question-authoring.js';
import { questionToDraft } from '#features/questions/authoring/draft-state.js';
import { saveQuestionAction } from '#features/questions/authoring/save-action.server.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/edit';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCapability(request, 'question:manage_own');

  const parsedId = questionsContract.get.pathParams.safeParse({ id: params.id });
  if (!parsedId.success) throw new Response('Mã câu hỏi không hợp lệ.', { status: 400 });

  try {
    const response = await createApiClient(request).request<unknown>({
      url: questionsContract.get.path.replace(':id', encodeURIComponent(parsedId.data.id)),
      method: questionsContract.get.method,
    });
    if (response.status !== 200) {
      throw new Response(getApiErrorMessage(response.data) ?? 'Không thể tải câu hỏi.', {
        status: response.status,
      });
    }

    const result = questionsContract.get.responses[200].safeParse(response.data);
    if (!result.success) {
      throw new Response('Phản hồi API không đúng question contract.', { status: 502 });
    }

    try {
      return { question: result.data, initialDraft: questionToDraft(result.data) };
    } catch {
      throw new Response('Dạng câu hỏi này chưa hỗ trợ mở lại trong trình biên soạn.', {
        status: 422,
      });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const parsedId = questionsContract.update.pathParams.safeParse({ id: params.id });
  if (!parsedId.success) {
    return Response.json({ error: 'Mã câu hỏi không hợp lệ.' }, { status: 400 });
  }
  return saveQuestionAction(request, parsedId.data.id);
}

export default function EditQuestion({ loaderData }: Route.ComponentProps) {
  return (
    <QuestionAuthoring
      key={loaderData.question.id}
      initialDraft={loaderData.initialDraft}
      initialQuestion={loaderData.question}
    />
  );
}

export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
