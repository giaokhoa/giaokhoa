import { questionsContract } from '@giaokhoa/shared/http/questions';
import { questionCreateSchema } from '@giaokhoa/shared/questions';
import { requireSession } from '#features/auth/api/session.server.js';
import { QuestionAuthoring } from '#features/questions/authoring/question-authoring.js';
import { createQuestionDraft } from '#features/questions/authoring/draft-state.js';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/new';

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);
  return { initialDraft: createQuestionDraft('multiple_choice') };
}

export async function action({ request }: Route.ActionArgs) {
  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || !('question' in body)) {
    return Response.json({ error: 'Dữ liệu câu hỏi không hợp lệ.' }, { status: 400 });
  }

  const questionResult = questionCreateSchema.safeParse(body.question);
  if (!questionResult.success) {
    return Response.json(
      { error: questionResult.error.issues.map(({ message }) => message).join('; ') },
      { status: 400 },
    );
  }

  let questionId: string | undefined;
  if ('questionId' in body && body.questionId !== undefined) {
    const paramsResult = questionsContract.update.pathParams.safeParse({ id: body.questionId });
    if (!paramsResult.success) {
      return Response.json({ error: 'Mã câu hỏi không hợp lệ.' }, { status: 400 });
    }
    questionId = paramsResult.data.id;
  }

  const isUpdate = Boolean(questionId);
  const contract = isUpdate ? questionsContract.update : questionsContract.create;
  const path = questionId
    ? questionsContract.update.path.replace(':id', encodeURIComponent(questionId))
    : questionsContract.create.path;
  const requestBody = contract.body.parse(questionResult.data);

  try {
    const response = await createApiClient(request).request<unknown>({
      url: path,
      method: contract.method,
      data: requestBody,
    });

    if (!isSuccessStatus(response.status)) {
      return Response.json(
        {
          error: getApiErrorMessage(response.data) ?? `Không thể lưu câu hỏi (${response.status})`,
        },
        { status: response.status },
      );
    }

    const responseSchema = isUpdate
      ? questionsContract.update.responses[200]
      : questionsContract.create.responses[201];
    const parsedResponse = responseSchema.safeParse(response.data);
    if (!parsedResponse.success) {
      return Response.json({ error: 'Phản hồi API không đúng question contract' }, { status: 502 });
    }

    return Response.json({ question: parsedResponse.data });
  } catch (error) {
    return Response.json(
      { error: getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.') },
      { status: 502 },
    );
  }
}

export default function NewQuestion({ loaderData }: Route.ComponentProps) {
  return <QuestionAuthoring initialDraft={loaderData.initialDraft} />;
}
