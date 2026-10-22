import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { classesContract } from '@giaokhoa/shared/http/classes';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Button } from '@giaokhoa/ui/components/button';
import { FieldGroup } from '@giaokhoa/ui/components/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Form, Link, redirect } from 'react-router';
import { getAccess } from '#features/workspace/access.server.js';
import { assignmentCapabilities } from '#features/workspace/access.js';
import { AssignmentFields } from '#features/workspace/assignment-fields.js';
import { assignmentInput } from '#features/workspace/assignment-input.server.js';
import {
  EmptyList,
  Feedback,
  InlineAction,
  Page,
  Panel,
  Status,
  SubmitButton,
} from '#features/workspace/ui.js';
import { actionError, apiData, parseInput, routeId } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import type { Route } from './+types/detail';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request, params }: Route.LoaderArgs) {
  const id = routeId(params.id, assignmentsContract.get.pathParams);
  const access = await getAccess(
    request,
    { kind: 'assignment', resourceKey: id },
    assignmentCapabilities,
  );
  const list = await apiData(request, '/assignments', assignmentsContract.list.responses[200]);
  const summary = list.find((item) => item.id === id);
  if (!summary) throw new Response('Bài giao không khả dụng.', { status: 404 });
  const can = (key: string) => summary.capabilities.includes(key);
  const [assignment, recipients, classes, attempts] = await Promise.all([
    can('assignment:create')
      ? apiData(request, `/assignments/${id}`, assignmentsContract.get.responses[200])
      : null,
    can('assignment:publish')
      ? apiData(
          request,
          `/assignments/${id}/recipients`,
          assignmentsContract.recipients.responses[200],
        )
      : [],
    can('assignment:create')
      ? apiData(request, '/classes', classesContract.list.responses[200])
      : [],
    can('assignment:attempt')
      ? apiData(request, '/attempts', attemptsContract.listOwn.responses[200])
      : [],
  ]);
  const classroom = classes.find((item) => item.id === summary.classId);
  const members = classroom?.capabilities.includes('class:enrolment_manage')
    ? await apiData(
        request,
        `/classes/${summary.classId}/members`,
        classesContract.members.responses[200],
      )
    : [];
  return {
    summary,
    assignment,
    access,
    recipients,
    members,
    attempts: attempts.filter((item) => item.assignmentId === id),
    now: Date.now(),
  };
}
export async function action({ request, params }: Route.ActionArgs) {
  try {
    const id = routeId(params.id, assignmentsContract.get.pathParams);
    await getAccess(request, { kind: 'assignment', resourceKey: id }, assignmentCapabilities);
    const form = await request.formData();
    if (form.get('intent') === 'update') {
      const body = parseInput(assignmentsContract.update.body, assignmentInput(form));
      await apiData(request, `/assignments/${id}`, assignmentsContract.update.responses[200], {
        method: 'PATCH',
        data: body,
      });
    } else if (form.get('intent') === 'publish') {
      await apiData(
        request,
        `/assignments/${id}/publish`,
        assignmentsContract.publish.responses[200],
        { method: 'POST' },
      );
    } else if (form.get('intent') === 'revoke') {
      const input = parseInput(assignmentsContract.revoke.pathParams, {
        id,
        userId: form.get('userId'),
      });
      await apiData(request, `/assignments/${id}/recipients/${input.userId}/revoke`, null, {
        method: 'POST',
      });
    } else if (form.get('intent') === 'start') {
      const attempt = await apiData(
        request,
        `/assignments/${id}/attempts`,
        attemptsContract.start.responses[201],
        { method: 'POST' },
      );
      return redirect(`/attempts/${attempt.id}`);
    } else throw new Response('Thao tác không hợp lệ.', { status: 400 });
    return { success: 'Đã cập nhật bài giao.' };
  } catch (error) {
    return actionError(error);
  }
}
export default function AssignmentDetail({
  loaderData: { summary, assignment, recipients, members, attempts, now },
  actionData,
}: Route.ComponentProps) {
  const can = (key: string) => summary.capabilities.includes(key);
  const open =
    new Date(summary.openAt).getTime() <= now && now < new Date(summary.closeAt).getTime();
  const unfinished = attempts.find((item) => item.status === 'in_progress');
  return (
    <Page
      title={summary.title}
      description={`${summary.className} · Tối đa ${summary.maxAttempts} lượt làm`}
      actions={<Status value={summary.status} />}
    >
      <Feedback {...actionData} />
      <Panel title="Lịch làm bài">
        <p>Mở bài: {formatDate(summary.openAt)}</p>
        <p>Đóng bài: {formatDate(summary.closeAt)}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {can('assignment:view_assigned') && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={`/assignments/${summary.id}/delivery`} />}
            >
              Xem đề
            </Button>
          )}
          {can('assignment:attempt') && (
            <InlineAction
              intent="start"
              label={unfinished ? 'Tiếp tục làm bài' : 'Bắt đầu làm bài'}
              disabled={!open || (!unfinished && attempts.length >= summary.maxAttempts)}
            />
          )}
          {can('assignment:grade') && (
            <Button
              nativeButton={false}
              render={<Link to={`/assignments/${summary.id}/attempts`} />}
            >
              Xem bài làm và chấm điểm
            </Button>
          )}
          {can('assignment:publish') && summary.status === 'draft' && (
            <InlineAction
              intent="publish"
              label="Công bố bài giao"
              confirm="Công bố sẽ chốt người nhận hiện tại và ngừng cho sửa cấu hình. Tiếp tục?"
            />
          )}
        </div>
        {can('assignment:attempt') && !open && (
          <p className="mt-3 text-sm text-muted-foreground">Hiện ngoài thời gian làm bài.</p>
        )}
      </Panel>
      {assignment &&
        (assignment.status === 'draft' ? (
          <Panel title="Chỉnh sửa bản nháp">
            <Form method="post">
              <input type="hidden" name="intent" value="update" />
              <FieldGroup>
                <AssignmentFields assignment={assignment} members={members} />
                <SubmitButton>Lưu cấu hình</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
        ) : (
          <Panel title="Lịch công bố">
            <p>Điểm: {formatDate(assignment.releaseScoreAt)}</p>
            <p>Nhận xét: {formatDate(assignment.releaseFeedbackAt)}</p>
            <p>Lời giải: {formatDate(assignment.releaseSolutionsAt)}</p>
          </Panel>
        ))}
      {can('assignment:publish') && (
        <Panel title="Người nhận đã chốt">
          {!recipients.length ? (
            <EmptyList>Người nhận được chốt khi công bố bài giao.</EmptyList>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Người học</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((item) => (
                  <TableRow key={item.userId}>
                    <TableCell>{item.userId}</TableCell>
                    <TableCell>
                      <Status value={item.status} />
                    </TableCell>
                    <TableCell>
                      {item.status === 'active' && (
                        <InlineAction
                          intent="revoke"
                          label="Thu hồi"
                          fields={{ userId: item.userId }}
                          confirm="Thu hồi quyền nhận và làm bài của học sinh này?"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}
      {attempts.length > 0 && (
        <Panel title="Các lượt làm của bạn">
          <ul className="flex flex-col gap-3">
            {attempts.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <Link to={`/attempts/${item.id}`} className="underline underline-offset-4">
                  Lượt {item.attemptNumber}
                </Link>
                <Status value={item.status} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Page>
  );
}
