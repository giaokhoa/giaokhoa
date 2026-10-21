import {
  EssayPreview,
  MultipleChoicePreview,
  ShortAnswerPreview,
  TrueFalsePreview,
} from '@giaokhoa/editor';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Button } from '@giaokhoa/ui/components/button';
import { Alert, AlertDescription } from '@giaokhoa/ui/components/alert';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { data, Form, redirect, useNavigation } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { requireAssignmentId } from '#features/assignments/assignment-api.server.js';
import {
  formatAssignmentDate,
  normalizeDates,
  parseDeliveryContent,
} from '#features/assignments/assignment-data.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/delivery';

export { AssignmentErrorBoundary as ErrorBoundary } from '#features/assignments/assignment-form.js';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const id = requireAssignmentId(params.id);
  try {
    const response = await createApiClient(request).request<unknown>({
      url: assignmentsContract.delivery.path.replace(':id', id),
      method: assignmentsContract.delivery.method,
    });
    if (response.status !== 200)
      throw new Response(
        getApiErrorMessage(response.data) ??
          'Bài giao chưa khả dụng hoặc bạn không có quyền nhận bài.',
        { status: response.status },
      );
    const result = assignmentsContract.delivery.responses[200].safeParse(
      normalizeDates(response.data, ['openAt', 'closeAt']),
    );
    if (!result.success || result.data.assignmentId !== id)
      throw new Response('Phản hồi đề được giao không đúng hợp đồng API.', { status: 502 });
    const questions = result.data.questions.map(({ position, question }) => {
      const content = parseDeliveryContent(question.type, question.content);
      if (!content.success)
        throw new Response(`Nội dung câu ${position} không hợp lệ.`, { status: 502 });
      return { position, question: { ...question, content: content.data } };
    });
    return { assignment: { ...result.data, questions } };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể tải đề được giao.'), {
      status: 502,
    });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireSession(request);
  const parsed = attemptsContract.start.pathParams.safeParse({ assignmentId: params.id });
  if (!parsed.success) return data({ error: 'Mã bài giao không hợp lệ.' }, { status: 400 });
  const form = await request.formData();
  if (form.get('intent') !== 'start')
    return data({ error: 'Thao tác không hợp lệ.' }, { status: 400 });
  try {
    const response = await createApiClient(request).request<unknown>({
      url: attemptsContract.start.path.replace(':assignmentId', parsed.data.assignmentId),
      method: attemptsContract.start.method,
    });
    if (response.status !== 201)
      return data(
        { error: getApiErrorMessage(response.data) ?? 'Không thể bắt đầu lượt làm bài.' },
        { status: response.status },
      );
    const attempt = normalizeDates(response.data, ['startedAt', 'submittedAt', 'gradedAt']);
    const body =
      attempt &&
      typeof attempt === 'object' &&
      'responses' in attempt &&
      Array.isArray(attempt.responses)
        ? {
            ...attempt,
            responses: attempt.responses.map((item) => normalizeDates(item, ['updatedAt'])),
          }
        : attempt;
    const result = attemptsContract.start.responses[201].safeParse(body);
    if (!result.success || result.data.assignmentId !== parsed.data.assignmentId)
      return data({ error: 'Phản hồi lượt làm bài không đúng hợp đồng API.' }, { status: 502 });
    return redirect(`/attempts/${result.data.id}`);
  } catch (error) {
    return data(
      { error: getRequestErrorMessage(error, 'Không thể bắt đầu lượt làm bài.') },
      { status: 502 },
    );
  }
}

export default function AssignmentDelivery({ loaderData, actionData }: Route.ComponentProps) {
  const { assignment } = loaderData;
  const navigation = useNavigation();
  const pending = navigation.state !== 'idle';
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{assignment.title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Đề được giao</CardTitle>
          <CardDescription>
            Chỉ đọc đề tại đây. Bắt đầu lượt làm để nhập và lưu câu trả lời.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <p>Mở: {formatAssignmentDate(assignment.openAt)}</p>
            <p>Đóng: {formatAssignmentDate(assignment.closeAt)}</p>
            <p>
              Tối đa {assignment.maxAttempts} lượt làm · {assignment.questions.length} câu hỏi
            </p>
            {actionData?.error && (
              <Alert variant="destructive">
                <AlertDescription>{actionData.error}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Form method="post">
            <input type="hidden" name="intent" value="start" />
            <Button type="submit" disabled={pending || assignment.questions.length === 0}>
              {pending && <Spinner data-icon="inline-start" aria-label="Đang bắt đầu" />}
              {pending ? 'Đang bắt đầu…' : 'Bắt đầu làm bài'}
            </Button>
          </Form>
        </CardFooter>
      </Card>
      {assignment.questions.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Đề chưa có câu hỏi</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {assignment.questions.map(({ position, question }) => (
        <Card key={position}>
          <CardHeader>
            <CardTitle>Câu {position}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {question.stimulus && (
                <section aria-label={`Ngữ liệu câu ${position}`}>
                  <EssayPreview content={question.stimulus.content} />
                </section>
              )}
              <fieldset disabled aria-label={`Nội dung câu ${position}`}>
                {question.type === 'multiple_choice' && (
                  <MultipleChoicePreview content={question.content} />
                )}
                {question.type === 'true_false' && <TrueFalsePreview content={question.content} />}
                {question.type === 'short_answer' && (
                  <ShortAnswerPreview content={question.content} />
                )}
                {question.type === 'essay' && (
                  <>
                    <EssayPreview
                      content={{
                        type: 'doc',
                        content: question.content.content?.filter(
                          (node) => node.type !== 'partList',
                        ),
                      }}
                    />
                    {question.content.content
                      ?.filter((node) => node.type === 'partList')
                      .flatMap((node) => node.content ?? [])
                      .map((part, index) => (
                        <section key={index} className="mt-3">
                          <p>Phần {index + 1}</p>
                          <EssayPreview content={{ type: 'doc', content: part.content }} />
                        </section>
                      ))}
                  </>
                )}
              </fieldset>
            </div>
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
