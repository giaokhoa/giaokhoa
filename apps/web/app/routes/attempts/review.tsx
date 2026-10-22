import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { Form } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { SavedAnswer } from '#features/attempts/attempt-ui.js';
import { parsePublishedSolution } from '#features/attempts/attempt-data.js';
import { QuestionPreview, RichDocument } from '#features/workspace/question-preview.js';
import { Feedback, InputField, Page, Panel, Status, SubmitButton } from '#features/workspace/ui.js';
import { apiData, actionError, parseInput, routeId } from '#lib/http/data.server.js';
import type { Route } from './+types/review';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const id = routeId(params.id, attemptsContract.review.pathParams);
  const attempt = await apiData(
    request,
    `/attempts/${id}/review`,
    attemptsContract.review.responses[200],
  );
  const preview = await apiData(
    request,
    `/assignments/${attempt.assignmentId}/preview`,
    assignmentsContract.preview.responses[200],
  );
  return { attempt, preview };
}
export async function action({ request, params }: Route.ActionArgs) {
  try {
    await requireSession(request);
    const id = routeId(params.id, attemptsContract.grade.pathParams);
    const form = await request.formData();
    const score = form.get('score');
    const feedback = form.get('feedback');
    if (typeof score !== 'string' || !score.trim())
      throw new Response('Hãy nhập điểm.', { status: 400 });
    const body = parseInput(attemptsContract.grade.body, {
      score: Number(score),
      feedback: typeof feedback === 'string' ? feedback.trim() || null : feedback,
    });
    await apiData(request, `/attempts/${id}/grade`, attemptsContract.grade.responses[200], {
      method: 'PATCH',
      data: body,
    });
    return { success: 'Đã lưu điểm và nhận xét.' };
  } catch (error) {
    return actionError(error);
  }
}
export default function Review({
  loaderData: { attempt, preview },
  actionData,
}: Route.ComponentProps) {
  return (
    <Page
      title={`Chấm bài · ${preview.title}`}
      description={`Người học: ${attempt.userId} · Lượt ${attempt.attemptNumber}`}
      actions={<Status value={attempt.status} />}
    >
      <Feedback {...actionData} />
      {preview.questions.map((item) => {
        const response = attempt.responses.find((response) => response.position === item.position);
        const solution = parsePublishedSolution(item.question.type, item.question.solution);
        return (
          <Panel key={item.position} title={`Câu ${item.position}`}>
            <div className="flex flex-col gap-5">
              {item.stimulus && <RichDocument value={item.stimulus.content} />}
              <QuestionPreview question={item.question} />
              <section>
                <h2 className="mb-2 font-medium">Câu trả lời của học sinh</h2>
                {response ? (
                  <SavedAnswer answer={response.answer} content={item.question.content} />
                ) : (
                  <p>Chưa trả lời.</p>
                )}
              </section>
              <details>
                <summary className="cursor-pointer font-medium">Đáp án tham khảo</summary>
                {solution && <SavedAnswer answer={solution} content={item.question.content} />}
              </details>
            </div>
          </Panel>
        );
      })}
      <Panel
        title="Điểm và nhận xét"
        description="Thang điểm 100. Học sinh chỉ được xem sau mốc công bố tương ứng."
      >
        {attempt.status === 'in_progress' ? (
          <p>Chỉ chấm bài sau khi học sinh đã nộp.</p>
        ) : (
          <Form method="post">
            <FieldGroup>
              <InputField
                name="score"
                label="Điểm"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={attempt.score ?? ''}
                required
              />
              <Field>
                <FieldLabel htmlFor="feedback">Nhận xét</FieldLabel>
                <Textarea
                  name="feedback"
                  id="feedback"
                  maxLength={5000}
                  defaultValue={attempt.feedback ?? ''}
                  rows={5}
                />
              </Field>
              <SubmitButton>Lưu điểm và nhận xét</SubmitButton>
            </FieldGroup>
          </Form>
        )}
      </Panel>
    </Page>
  );
}
