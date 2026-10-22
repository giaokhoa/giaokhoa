import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { requireSession } from '#features/auth/api/session.server.js';
import { QuestionPreview, RichDocument } from '#features/workspace/question-preview.js';
import { Feedback, InlineAction, Page, Panel } from '#features/workspace/ui.js';
import { apiData, actionError, routeId } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import { redirect } from 'react-router';
import type { Route } from './+types/delivery';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const id = routeId(params.id, assignmentsContract.delivery.pathParams);
  return {
    delivery: await apiData(
      request,
      `/assignments/${id}/delivery`,
      assignmentsContract.delivery.responses[200],
    ),
    now: Date.now(),
  };
}
export async function action({ request, params }: Route.ActionArgs) {
  try {
    await requireSession(request);
    const id = routeId(params.id, assignmentsContract.delivery.pathParams);
    const form = await request.formData();
    if (form.get('intent') !== 'start')
      throw new Response('Thao tác không hợp lệ.', { status: 400 });
    const attempt = await apiData(
      request,
      `/assignments/${id}/attempts`,
      attemptsContract.start.responses[201],
      { method: 'POST' },
    );
    return redirect(`/attempts/${attempt.id}`);
  } catch (error) {
    return actionError(error);
  }
}
export default function Delivery({
  loaderData: { delivery, now },
  actionData,
}: Route.ComponentProps) {
  return (
    <Page
      title={delivery.title}
      description={`Hạn nộp: ${formatDate(delivery.closeAt)} · Tối đa ${delivery.maxAttempts} lượt`}
      actions={
        <InlineAction
          intent="start"
          label="Bắt đầu / tiếp tục làm bài"
          disabled={now >= new Date(delivery.closeAt).getTime()}
        />
      }
    >
      <Feedback {...actionData} />
      {delivery.questions.map((item) => (
        <Panel key={item.position} title={`Câu ${item.position}`}>
          <div className="flex flex-col gap-4">
            {item.question.stimulus && <RichDocument value={item.question.stimulus.content} />}
            <QuestionPreview question={item.question} />
          </div>
        </Panel>
      ))}
    </Page>
  );
}
