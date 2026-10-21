import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Button } from '@giaokhoa/ui/components/button';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@giaokhoa/ui/components/empty';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { data, Link, useFetcher } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { requestAttemptApi } from '#features/attempts/attempt-api.server.js';
import { attemptStatusLabels, formatAttemptDate } from '#features/attempts/attempt-data.js';
import { AttemptMessage, RefreshAttempt, SavedAnswer } from '#features/attempts/attempt-ui.js';
import type { Route } from './+types/review';

export {
  AttemptErrorBoundary as ErrorBoundary,
  AttemptLoading as HydrateFallback,
} from '#features/attempts/attempt-ui.js';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const parsed = attemptsContract.review.pathParams.safeParse(params);
  if (!parsed.success) throw new Response('Mã lượt làm bài không hợp lệ.', { status: 400 });
  return { attempt: await requestAttemptApi(request, attemptsContract.review, parsed.data) };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireSession(request);
  const parsed = attemptsContract.grade.pathParams.safeParse(params);
  if (!parsed.success) return data({ error: 'Mã lượt làm bài không hợp lệ.' }, { status: 400 });
  try {
    const form = await request.formData();
    const score = form.get('score');
    const grade = attemptsContract.grade.body.safeParse({
      score: typeof score === 'string' && score.trim() ? Number(score) : NaN,
      feedback: form.get('feedback') || null,
    });
    if (!grade.success)
      return data(
        {
          error:
            'Điểm phải từ 0 đến 100, tối đa hai chữ số thập phân; nhận xét tối đa 5.000 ký tự.',
        },
        { status: 400 },
      );
    await requestAttemptApi(request, attemptsContract.grade, parsed.data, grade.data);
    return data({ success: 'Đã lưu điểm và nhận xét.' });
  } catch (error) {
    return data(
      {
        error: error instanceof Response ? await error.text() : 'Không thể xử lý yêu cầu chấm bài.',
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
}

export default function AttemptReview({ loaderData }: Route.ComponentProps) {
  const { attempt } = loaderData;
  const fetcher = useFetcher<typeof action>();
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Chấm lượt làm bài · Lần {attempt.attemptNumber}
          </h1>
          <p>
            Mã học sinh: <code>{attempt.userId}</code>
          </p>
          <Badge variant="secondary">{attemptStatusLabels[attempt.status]}</Badge>
          <p>Nộp lúc: {formatAttemptDate(attempt.submittedAt)}</p>
        </div>
        <RefreshAttempt />
      </div>
      <Link to={`/assignments/${attempt.assignmentId}/attempts`}>
        Danh sách lượt làm của bài giao
      </Link>
      <AttemptMessage title="Đề và câu trả lời đã lưu">
        <p>API chấm bài chỉ trả câu trả lời theo vị trí trong đề.</p>
        <Link to={`/assignments/${attempt.assignmentId}`}>Mở bài giao để đối chiếu đề</Link>
      </AttemptMessage>
      {attempt.responses.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Chưa có câu trả lời</EmptyTitle>
            <EmptyDescription>Học sinh chưa lưu câu trả lời nào.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {attempt.responses.map((response) => (
        <AttemptMessage key={response.position} title={`Câu ${response.position}`}>
          <SavedAnswer answer={response.answer} />
          <p>Lưu lúc: {formatAttemptDate(response.updatedAt)}</p>
        </AttemptMessage>
      ))}
      <AttemptMessage title="Điểm và nhận xét">
        {attempt.status === 'in_progress' ? (
          <p role="status">Học sinh chưa nộp bài. Chỉ chấm sau khi bài đã nộp.</p>
        ) : (
          <fetcher.Form method="post" key={attempt.id}>
            <fieldset disabled={fetcher.state !== 'idle'}>
              <FieldGroup>
                <Field data-invalid={!!fetcher.data && 'error' in fetcher.data}>
                  <FieldLabel htmlFor="grade-score">Điểm (thang 100)</FieldLabel>
                  <Input
                    id="grade-score"
                    name="score"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    defaultValue={attempt.score ?? ''}
                    aria-invalid={!!fetcher.data && 'error' in fetcher.data}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="grade-feedback">Nhận xét</FieldLabel>
                  <Textarea
                    id="grade-feedback"
                    name="feedback"
                    rows={5}
                    maxLength={5000}
                    defaultValue={attempt.feedback ?? ''}
                  />
                  <FieldDescription>
                    Học sinh chỉ thấy điểm và nhận xét khi API cho phép theo từng mốc công bố.
                  </FieldDescription>
                </Field>
                {fetcher.data && 'error' in fetcher.data && (
                  <FieldError>{fetcher.data.error}</FieldError>
                )}
                {fetcher.data && 'success' in fetcher.data && (
                  <p role="status">{fetcher.data.success}</p>
                )}
                <Button type="submit">
                  {fetcher.state !== 'idle' && (
                    <Spinner aria-label="Đang lưu" data-icon="inline-start" />
                  )}
                  {fetcher.state === 'idle'
                    ? attempt.status === 'graded'
                      ? 'Lưu điểm và nhận xét mới'
                      : 'Lưu điểm và nhận xét'
                    : 'Đang lưu…'}
                </Button>
              </FieldGroup>
            </fieldset>
          </fetcher.Form>
        )}
      </AttemptMessage>
    </main>
  );
}
