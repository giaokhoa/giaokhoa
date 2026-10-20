import { questionsContract } from '@giaokhoa/shared/http/questions';
import { questionCreateSchema } from '@giaokhoa/shared/questions';
import { requireSession } from '#features/auth/api/session.server.js';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';

export async function saveQuestionAction(request: Request, routeQuestionId?: string) {
  await requireSession(request);
  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || !('question' in body)) {
    return Response.json({ error: 'Dữ liệu câu hỏi không hợp lệ.' }, { status: 400 });
  }

  let questionId: string | undefined;
  if ('questionId' in body && body.questionId !== undefined) {
    const paramsResult = questionsContract.update.pathParams.safeParse({ id: body.questionId });
    if (!paramsResult.success) {
      return Response.json({ error: 'Mã câu hỏi không hợp lệ.' }, { status: 400 });
    }
    questionId = paramsResult.data.id;
  }
  if (routeQuestionId !== undefined && questionId !== routeQuestionId) {
    return Response.json({ error: 'Mã câu hỏi không khớp đường dẫn.' }, { status: 400 });
  }

  const isUpdate = Boolean(questionId);
  const questionResult = (
    isUpdate ? questionsContract.update.body : questionCreateSchema
  ).safeParse(body.question);
  if (!questionResult.success) {
    return Response.json(
      { error: questionResult.error.issues.map(({ message }) => message).join('; ') },
      { status: 400 },
    );
  }

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
          status: response.status,
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
