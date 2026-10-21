import type { AttemptAnswer } from '@giaokhoa/shared/attempts';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Button } from '@giaokhoa/ui/components/button';
import { Alert, AlertTitle, AlertDescription } from '@giaokhoa/ui/components/alert';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@giaokhoa/ui/components/empty';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@giaokhoa/ui/components/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import { useCallback, useState } from 'react';
import { data, Link, useBeforeUnload, useBlocker, useFetcher, useFetchers } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { AnswerForm } from '#features/attempts/answer-form.js';
import { optionalAttemptData, requestAttemptApi } from '#features/attempts/attempt-api.server.js';
import {
  attemptStatusLabels,
  formatAttemptDate,
  normalizeDeliveryDates,
  parseAnswer,
  parsePublishedSolution,
} from '#features/attempts/attempt-data.js';
import { AttemptMessage, RefreshAttempt, SavedAnswer } from '#features/attempts/attempt-ui.js';
import type { Route } from './+types/detail';

export {
  AttemptErrorBoundary as ErrorBoundary,
  AttemptLoading as HydrateFallback,
} from '#features/attempts/attempt-ui.js';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const parsed = attemptsContract.get.pathParams.safeParse(params);
  if (!parsed.success) throw new Response('Mã lượt làm bài không hợp lệ.', { status: 400 });
  const attempt = await requestAttemptApi(request, attemptsContract.get, parsed.data);
  const [delivery, result, solutions] = await Promise.all([
    optionalAttemptData(
      requestAttemptApi(
        request,
        assignmentsContract.delivery,
        { id: attempt.assignmentId },
        undefined,
        normalizeDeliveryDates,
      ),
    ),
    attempt.status === 'in_progress'
      ? { value: null, error: null }
      : optionalAttemptData(requestAttemptApi(request, attemptsContract.result, parsed.data)),
    attempt.status === 'in_progress'
      ? { value: null, error: null }
      : optionalAttemptData(requestAttemptApi(request, attemptsContract.solutions, parsed.data)),
  ]);
  return { attempt, delivery, result, solutions };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireSession(request);
  const parsed = attemptsContract.get.pathParams.safeParse(params);
  if (!parsed.success) return data({ error: 'Mã lượt làm bài không hợp lệ.' }, { status: 400 });
  try {
    const form = await request.formData();
    const intent = form.get('intent');
    if (intent === 'submit') {
      if (form.get('confirm') !== 'yes')
        return data({ error: 'Hãy xác nhận nộp bài.' }, { status: 400 });
      await requestAttemptApi(request, attemptsContract.submit, parsed.data);
      return data({ success: 'Đã nộp bài.' });
    }
    if (intent !== 'save') return data({ error: 'Thao tác không hợp lệ.' }, { status: 400 });
    const position = attemptsContract.save.pathParams.safeParse({
      ...parsed.data,
      position: form.get('position'),
    });
    let answer: AttemptAnswer | null = null;
    try {
      const rawAnswer = form.get('answer');
      answer = typeof rawAnswer === 'string' ? parseAnswer(JSON.parse(rawAnswer)) : null;
    } catch {
      return data({ error: 'Câu trả lời không đúng định dạng.' }, { status: 400 });
    }
    if (!position.success || !answer)
      return data({ error: 'Vị trí hoặc câu trả lời không hợp lệ.' }, { status: 400 });
    await requestAttemptApi(request, attemptsContract.save, position.data, answer);
    return data({ success: 'Đã lưu câu trả lời.' });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Response
            ? await error.text()
            : 'Không thể xử lý yêu cầu. Vui lòng thử lại.',
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
}

export default function AttemptDetail({ loaderData }: Route.ComponentProps) {
  return <AttemptWorkspace key={loaderData.attempt.id} loaderData={loaderData} />;
}

function AttemptWorkspace({ loaderData }: Pick<Route.ComponentProps, 'loaderData'>) {
  const { attempt, delivery, result, solutions } = loaderData;
  // Không giữ bản đề cũ khi API thu hồi quyền đọc đề ở lần tải lại.
  const currentDelivery = delivery.value;
  const submitter = useFetcher<typeof action>();
  const fetchers = useFetchers();
  const [dirtyPositions, setDirtyPositions] = useState<number[]>([]);
  const onDirty = useCallback((position: number, dirty: boolean) => {
    setDirtyPositions((current) =>
      dirty
        ? current.includes(position)
          ? current
          : [...current, position]
        : current.includes(position)
          ? current.filter((value) => value !== position)
          : current,
    );
  }, []);
  const busy = fetchers.some((fetcher) => fetcher.state !== 'idle');
  const hasUnsaved = dirtyPositions.length > 0;
  const blocker = useBlocker(hasUnsaved || busy);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (hasUnsaved || busy) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [hasUnsaved, busy],
    ),
  );
  const isInProgress = attempt.status === 'in_progress';

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {currentDelivery?.title ?? 'Lượt làm bài'} · Lần {attempt.attemptNumber}
          </h1>
          <Badge variant="secondary">{attemptStatusLabels[attempt.status]}</Badge>
          <p>Bắt đầu: {formatAttemptDate(attempt.startedAt)}</p>
          {attempt.submittedAt && <p>Đã nộp: {formatAttemptDate(attempt.submittedAt)}</p>}
        </div>
        <RefreshAttempt />
      </div>
      {blocker.state === 'blocked' && (
        <Alert>
          <AlertTitle>Còn nội dung chưa lưu hoặc thao tác đang xử lý</AlertTitle>
          <AlertDescription>Ở lại để lưu câu trả lời trước khi rời trang.</AlertDescription>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => blocker.reset()}>Ở lại</Button>
            <Button variant="outline" onClick={() => blocker.proceed()}>
              Rời trang
            </Button>
          </div>
        </Alert>
      )}
      <Tabs defaultValue="answers">
        <TabsList>
          <TabsTrigger value="answers">Bài làm</TabsTrigger>
          <TabsTrigger value="result">Kết quả</TabsTrigger>
          <TabsTrigger value="solutions">Lời giải</TabsTrigger>
        </TabsList>
        <TabsContent value="answers" keepMounted>
          <div className="flex flex-col gap-4">
            {delivery.error && (
              <Alert variant="destructive">
                <AlertTitle>Chưa tải được đề bài</AlertTitle>
                <AlertDescription>
                  <p>{delivery.error}</p>
                  <Link to={`/assignments/${attempt.assignmentId}/delivery`}>
                    Mở trang đề được giao
                  </Link>
                </AlertDescription>
              </Alert>
            )}
            {currentDelivery && (
              <>
                <p>
                  Hạn làm bài: {formatAttemptDate(currentDelivery.closeAt)}. Lưu từng câu trước khi
                  nộp; máy chủ kiểm tra thời hạn khi lưu và nộp.
                </p>
                {currentDelivery.questions.length === 0 && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Đề chưa có câu hỏi</EmptyTitle>
                      <EmptyDescription>Không có câu hỏi để hiển thị.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                {currentDelivery.questions.map((item) => (
                  <AnswerForm
                    key={item.position}
                    item={item}
                    saved={
                      attempt.responses.find((response) => response.position === item.position)
                        ?.answer
                    }
                    onDirty={onDirty}
                    readOnly={!isInProgress}
                  />
                ))}
              </>
            )}
            {(!currentDelivery ||
              attempt.responses.some(
                (response) =>
                  !currentDelivery.questions.some((item) => item.position === response.position),
              )) && (
              <>
                {attempt.responses.length === 0 && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Chưa có câu trả lời đã lưu</EmptyTitle>
                      <EmptyDescription>
                        Lượt làm bài này chưa lưu câu trả lời nào.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                {attempt.responses
                  .filter(
                    (response) =>
                      !currentDelivery?.questions.some(
                        (item) => item.position === response.position,
                      ),
                  )
                  .map((response) => (
                    <AttemptMessage key={response.position} title={`Câu ${response.position}`}>
                      <SavedAnswer answer={response.answer} />
                      <p>Lưu lúc: {formatAttemptDate(response.updatedAt)}</p>
                    </AttemptMessage>
                  ))}
              </>
            )}
            {isInProgress && (
              <AttemptMessage title="Nộp bài">
                <submitter.Form method="post">
                  <FieldGroup>
                    <input type="hidden" name="intent" value="submit" />
                    <Field data-disabled={busy || hasUnsaved} orientation="horizontal">
                      <input
                        id="confirm-submit"
                        type="checkbox"
                        name="confirm"
                        value="yes"
                        required
                        disabled={busy || hasUnsaved}
                      />
                      <FieldLabel htmlFor="confirm-submit">
                        Tôi xác nhận nộp bài và kết thúc lượt làm này.
                      </FieldLabel>
                    </Field>
                    <FieldDescription>
                      {hasUnsaved
                        ? 'Hãy lưu tất cả thay đổi trước khi nộp.'
                        : 'Bài nộp chỉ gồm câu trả lời đã lưu. Sau khi nộp, bạn không thể sửa bài.'}
                    </FieldDescription>
                    {submitter.data && 'error' in submitter.data && (
                      <FieldError>{submitter.data.error}</FieldError>
                    )}
                    <Button type="submit" disabled={busy || hasUnsaved}>
                      {submitter.state !== 'idle' && (
                        <Spinner aria-label="Đang nộp" data-icon="inline-start" />
                      )}
                      {submitter.state === 'idle' ? 'Nộp bài' : 'Đang nộp…'}
                    </Button>
                  </FieldGroup>
                </submitter.Form>
              </AttemptMessage>
            )}
          </div>
        </TabsContent>
        <TabsContent value="result">
          <AttemptMessage title="Kết quả bài làm">
            {result.value ? (
              <div className="flex flex-col gap-3">
                <p>
                  Điểm: {result.value.score === null ? 'Chưa công bố' : `${result.value.score}/100`}
                </p>
                <p className="whitespace-pre-wrap">
                  Nhận xét: {result.value.feedback ?? 'Chưa công bố'}
                </p>
                <p>Chấm lúc: {formatAttemptDate(result.value.gradedAt)}</p>
              </div>
            ) : (
              <p role="status">
                {result.error ??
                  'Kết quả chỉ có sau khi nộp, được chấm và được API cho phép công bố.'}
              </p>
            )}
          </AttemptMessage>
        </TabsContent>
        <TabsContent value="solutions">
          <div className="flex flex-col gap-4">
            {solutions.value ? (
              solutions.value.questions.length === 0 ? (
                <AttemptMessage title="Chưa có lời giải">
                  <p>API chưa trả về lời giải cho câu hỏi nào.</p>
                </AttemptMessage>
              ) : (
                solutions.value.questions.map((item) => {
                  const question = currentDelivery?.questions.find(
                    (question) => question.position === item.position,
                  )?.question;
                  const type =
                    question?.type ??
                    attempt.responses.find((response) => response.position === item.position)
                      ?.answer.type;
                  const answer = parsePublishedSolution(type, item.solution);
                  return (
                    <AttemptMessage key={item.position} title={`Lời giải câu ${item.position}`}>
                      {answer ? (
                        <SavedAnswer answer={answer} content={question?.content} />
                      ) : (
                        <pre className="overflow-auto break-words whitespace-pre-wrap">
                          {JSON.stringify(item.solution, null, 2)}
                        </pre>
                      )}
                    </AttemptMessage>
                  );
                })
              )
            ) : (
              <AttemptMessage title="Lời giải chưa khả dụng">
                <p role="status">
                  {solutions.error ?? 'Lời giải chỉ được hiển thị khi API cho phép công bố.'}
                </p>
              </AttemptMessage>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
