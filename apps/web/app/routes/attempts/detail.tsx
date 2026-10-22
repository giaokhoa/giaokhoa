import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Button } from '@giaokhoa/ui/components/button';
import { useCallback, useState } from 'react';
import { useBeforeUnload, useBlocker, useFetcher, useFetchers, useRevalidator } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { AnswerForm } from '#features/attempts/answer-form.js';
import { parseAnswer, parsePublishedSolution } from '#features/attempts/attempt-data.js';
import { SavedAnswer } from '#features/attempts/attempt-ui.js';
import { Feedback, Page, Panel, Status } from '#features/workspace/ui.js';
import { apiData, actionError, parseInput, routeId } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import type { Route } from './+types/detail';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';

async function optionalData<T>(promise: Promise<T>) {
  try {
    return { value: await promise, error: undefined };
  } catch (error) {
    if (error instanceof Response && error.status >= 300 && error.status < 400) throw error;
    return {
      value: null,
      error: error instanceof Response ? await error.text() : 'Không thể tải dữ liệu. Hãy thử lại.',
    };
  }
}
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const id = routeId(params.id, attemptsContract.get.pathParams);
  const attempt = await apiData(request, `/attempts/${id}`, attemptsContract.get.responses[200]);
  const [delivery, result, solutions] = await Promise.all([
    optionalData(
      apiData(
        request,
        `/assignments/${attempt.assignmentId}/delivery`,
        assignmentsContract.delivery.responses[200],
      ),
    ),
    attempt.status === 'in_progress'
      ? { value: null, error: undefined }
      : optionalData(
          apiData(request, `/attempts/${id}/result`, attemptsContract.result.responses[200]),
        ),
    attempt.status === 'in_progress'
      ? { value: null, error: undefined }
      : optionalData(
          apiData(request, `/attempts/${id}/solutions`, attemptsContract.solutions.responses[200]),
        ),
  ]);
  return { attempt, delivery, result, solutions, now: Date.now() };
}
export async function action({ request, params }: Route.ActionArgs) {
  try {
    await requireSession(request);
    const id = routeId(params.id, attemptsContract.get.pathParams);
    const form = await request.formData();
    if (form.get('intent') === 'submit') {
      if (form.get('confirm') !== 'yes')
        throw new Response('Hãy xác nhận nộp bài.', { status: 400 });
      await apiData(request, `/attempts/${id}/submit`, attemptsContract.submit.responses[200], {
        method: 'POST',
      });
      return { success: 'Đã nộp bài.' };
    }
    if (form.get('intent') !== 'save')
      throw new Response('Thao tác không hợp lệ.', { status: 400 });
    const responseParams = parseInput(attemptsContract.save.pathParams, {
      id,
      position: form.get('position'),
    });
    let answer;
    try {
      answer = parseAnswer(
        JSON.parse(typeof form.get('answer') === 'string' ? (form.get('answer') as string) : ''),
      );
    } catch {
      /* Lỗi định dạng được chuyển thành phản hồi xác thực bên dưới. */
    }
    if (!answer) throw new Response('Câu trả lời không hợp lệ.', { status: 400 });
    await apiData(
      request,
      `/attempts/${id}/responses/${responseParams.position}`,
      attemptsContract.save.responses[200],
      { method: 'PUT', data: answer },
    );
    return { success: 'Đã lưu câu trả lời.' };
  } catch (error) {
    return actionError(error);
  }
}
export default function AttemptDetail({ loaderData }: Route.ComponentProps) {
  return <AttemptWorkspace key={loaderData.attempt.id} loaderData={loaderData} />;
}
function AttemptWorkspace({
  loaderData: { attempt, delivery, result, solutions, now },
}: Pick<Route.ComponentProps, 'loaderData'>) {
  const [dirty, setDirty] = useState<number[]>([]);
  const submitter = useFetcher<typeof action>();
  const fetchers = useFetchers();
  const revalidator = useRevalidator();
  const busy = fetchers.some((item) => item.state !== 'idle');
  const onDirty = useCallback(
    (position: number, changed: boolean) =>
      setDirty((current) =>
        changed
          ? current.includes(position)
            ? current
            : [...current, position]
          : current.includes(position)
            ? current.filter((item) => item !== position)
            : current,
      ),
    [],
  );
  const hasUnsaved = dirty.length > 0 || busy;
  const blocker = useBlocker(hasUnsaved);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (hasUnsaved) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [hasUnsaved],
    ),
  );
  const canEdit =
    attempt.status === 'in_progress' &&
    !!delivery.value &&
    now < new Date(delivery.value.closeAt).getTime();
  return (
    <Page
      title={`${delivery.value?.title ?? 'Bài làm'} · Lượt ${attempt.attemptNumber}`}
      description={`Bắt đầu: ${formatDate(attempt.startedAt)}${delivery.value ? ` · Hạn nộp: ${formatDate(delivery.value.closeAt)}` : ''}`}
      actions={<Status value={attempt.status} />}
    >
      <Feedback {...submitter.data} />
      {blocker.state === 'blocked' && (
        <Panel title="Có câu trả lời chưa lưu">
          <div className="flex gap-3">
            <Button onClick={() => blocker.reset()}>Ở lại để lưu</Button>
            <Button variant="outline" onClick={() => blocker.proceed()}>
              Rời trang
            </Button>
          </div>
        </Panel>
      )}
      {delivery.value ? (
        delivery.value.questions.map((item) => (
          <AnswerForm
            key={item.position}
            item={item}
            saved={
              attempt.responses.find((response) => response.position === item.position)?.answer
            }
            onDirty={onDirty}
            readOnly={!canEdit}
          />
        ))
      ) : (
        <>
          <Feedback error={delivery.error} />
          {attempt.responses.map((response) => (
            <Panel key={response.position} title={`Câu ${response.position}`}>
              <SavedAnswer answer={response.answer} />
            </Panel>
          ))}
        </>
      )}
      {attempt.status === 'in_progress' && (
        <Panel title="Nộp bài">
          <div className="flex flex-col gap-4">
            <p>
              {dirty.length
                ? `${dirty.length} câu có thay đổi chưa lưu. Hãy lưu từng câu trước khi nộp.`
                : 'Các câu đã lưu sẽ được nộp. Bạn không thể sửa câu trả lời sau khi nộp.'}
            </p>
            <submitter.Form
              method="post"
              onSubmit={(event) => {
                if (hasUnsaved || !window.confirm('Nộp bài và kết thúc lượt làm này?'))
                  event.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="submit" />
              <input type="hidden" name="confirm" value="yes" />
              <Button type="submit" disabled={hasUnsaved || !canEdit}>
                Nộp bài
              </Button>
            </submitter.Form>
          </div>
        </Panel>
      )}
      {attempt.status !== 'in_progress' && (
        <>
          <Panel title="Kết quả">
            {result.value ? (
              <div className="flex flex-col gap-3">
                <p>
                  Điểm:{' '}
                  {result.value.score === null ? 'Chưa công bố' : `${result.value.score} / 100`}
                </p>
                <p className="whitespace-pre-wrap">
                  Nhận xét: {result.value.feedback ?? 'Chưa công bố'}
                </p>
              </div>
            ) : (
              <p>{result.error}</p>
            )}
          </Panel>
          <Panel title="Lời giải">
            {solutions.value ? (
              solutions.value.questions.map((item) => {
                const question = delivery.value?.questions.find(
                  (question) => question.position === item.position,
                )?.question;
                const answer = parsePublishedSolution(question?.type, item.solution);
                return (
                  <section className="mb-5" key={item.position}>
                    <h2 className="mb-2 font-medium">Câu {item.position}</h2>
                    {answer ? (
                      <SavedAnswer answer={answer} content={question?.content} />
                    ) : (
                      <p>Không có nội dung đề để đối chiếu lời giải.</p>
                    )}
                  </section>
                );
              })
            ) : (
              <p>{solutions.error}</p>
            )}
          </Panel>
        </>
      )}
      <Button
        variant="outline"
        disabled={hasUnsaved || revalidator.state !== 'idle'}
        onClick={() => void revalidator.revalidate()}
      >
        Tải lại dữ liệu
      </Button>
    </Page>
  );
}
