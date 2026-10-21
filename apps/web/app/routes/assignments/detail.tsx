import type { AssignmentRecipient } from '@giaokhoa/shared/assignments';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { Button } from '@giaokhoa/ui/components/button';
import { Alert, AlertDescription } from '@giaokhoa/ui/components/alert';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { data, Form, Link, useNavigation } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import {
  loadAssignment,
  requireAssignmentId,
} from '#features/assignments/assignment-api.server.js';
import {
  assignmentDateFields,
  assignmentFieldErrors,
  formatAssignmentDate,
  normalizeDates,
  readAssignmentForm,
  scheduleFields,
} from '#features/assignments/assignment-data.js';
import { AssignmentForm } from '#features/assignments/assignment-form.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/detail';

export { AssignmentErrorBoundary as ErrorBoundary } from '#features/assignments/assignment-form.js';

type ActionResult = { error?: string; fieldErrors?: Record<string, string>; success?: string };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const id = requireAssignmentId(params.id);
  const assignment = await loadAssignment(request, id);
  let recipients: AssignmentRecipient[] = [];
  let recipientsError: string | undefined;
  try {
    const response = await createApiClient(request).request<unknown>({
      url: assignmentsContract.recipients.path.replace(':id', encodeURIComponent(id)),
      method: assignmentsContract.recipients.method,
    });
    if (response.status !== 200) {
      recipientsError = getApiErrorMessage(response.data) ?? 'Không thể tải người nhận.';
    } else {
      const body = Array.isArray(response.data)
        ? response.data.map((recipient) => normalizeDates(recipient, ['assignedAt', 'revokedAt']))
        : response.data;
      const result = assignmentsContract.recipients.responses[200].safeParse(body);
      if (result.success) recipients = result.data;
      else recipientsError = 'Phản hồi người nhận không đúng hợp đồng API.';
    }
  } catch (error) {
    recipientsError = getRequestErrorMessage(error, 'Không thể tải người nhận.');
  }
  return { assignment, recipients, recipientsError };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireSession(request);
  const id = requireAssignmentId(params.id);
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent !== 'update' && intent !== 'publish' && intent !== 'revoke') {
    return data<ActionResult>({ error: 'Thao tác không hợp lệ.' }, { status: 400 });
  }

  try {
    let body: unknown;
    let url: string;
    let method: string;
    if (intent === 'revoke') {
      const parsed = assignmentsContract.revoke.pathParams.safeParse({
        id,
        userId: form.get('userId'),
      });
      if (!parsed.success)
        return data<ActionResult>({ error: 'Mã học sinh không hợp lệ.' }, { status: 400 });
      url = assignmentsContract.revoke.path
        .replace(':id', id)
        .replace(':userId', encodeURIComponent(parsed.data.userId));
      method = assignmentsContract.revoke.method;
    } else {
      const assignment = await loadAssignment(request, id);
      if (assignment.status !== 'draft')
        return data<ActionResult>(
          { error: 'Bài giao đã công bố, không thể sửa hoặc công bố lại.' },
          { status: 409 },
        );
      if (intent === 'update') {
        const parsed = readAssignmentForm(form, assignment);
        if (!parsed.success) {
          return data<ActionResult>(
            {
              error: 'Vui lòng kiểm tra cấu hình bài giao.',
              fieldErrors: assignmentFieldErrors(parsed.error.issues),
            },
            { status: 400 },
          );
        }
        const { classId: _classId, examRevisionId: _examRevisionId, ...patch } = parsed.data;
        const patchResult = assignmentsContract.update.body.safeParse(patch);
        if (!patchResult.success)
          return data<ActionResult>({ error: 'Cấu hình cập nhật không hợp lệ.' }, { status: 400 });
        body = patchResult.data;
        url = assignmentsContract.update.path.replace(':id', id);
        method = assignmentsContract.update.method;
      } else {
        url = assignmentsContract.publish.path.replace(':id', id);
        method = assignmentsContract.publish.method;
      }
    }

    const response = await createApiClient(request).request<unknown>({ url, method, data: body });
    const expectedStatus = intent === 'revoke' ? 204 : 200;
    if (response.status !== expectedStatus) {
      return data<ActionResult>(
        {
          error: getApiErrorMessage(response.data) ?? 'Không thể thực hiện thao tác với bài giao.',
        },
        { status: response.status },
      );
    }
    if (intent !== 'revoke') {
      const contract =
        intent === 'publish' ? assignmentsContract.publish : assignmentsContract.update;
      const result = contract.responses[200].safeParse(
        normalizeDates(response.data, assignmentDateFields),
      );
      if (!result.success)
        return data<ActionResult>(
          { error: 'Phản hồi bài giao không đúng hợp đồng API.' },
          { status: 502 },
        );
    }
    const messages = {
      update: 'Đã lưu bản nháp.',
      publish: 'Đã công bố bài giao và chốt người nhận.',
      revoke: 'Đã thu hồi quyền nhận bài của học sinh.',
    };
    return data<ActionResult>({ success: messages[intent] });
  } catch (error) {
    if (error instanceof Response) {
      return data<ActionResult>({ error: await error.text() }, { status: error.status });
    }
    return data<ActionResult>(
      { error: getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.') },
      { status: 502 },
    );
  }
}

export default function AssignmentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { assignment, recipients, recipientsError } = loaderData;
  const navigation = useNavigation();
  const pending = navigation.state !== 'idle';
  const draft = assignment.status === 'draft';

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Chi tiết bài giao</h1>
      {actionData?.success && (
        <Alert role="status">
          <AlertDescription>{actionData.success}</AlertDescription>
        </Alert>
      )}
      {actionData?.error && (
        <Alert variant="destructive">
          <AlertDescription>{actionData.error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <Badge variant={draft ? 'secondary' : 'default'}>
              {draft ? 'Bản nháp' : 'Đã công bố'}
            </Badge>
          </CardTitle>
          <CardDescription>Mã bài giao: {assignment.id}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Thông tin</TableHead>
                <TableHead scope="col">Giá trị</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableHead scope="row">Mã lớp</TableHead>
                <TableCell className="break-all">{assignment.classId}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">Mã phiên bản đề</TableHead>
                <TableCell className="break-all">{assignment.examRevisionId}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">Đối tượng</TableHead>
                <TableCell>
                  {assignment.audienceMode === 'ALL_CLASS' ? 'Cả lớp' : 'Học sinh cụ thể'}
                </TableCell>
              </TableRow>
              {assignment.audienceMode === 'SELECTED_USERS' && (
                <TableRow>
                  <TableHead scope="row">Mã học sinh được chọn</TableHead>
                  <TableCell className="break-all">
                    {assignment.selectedUserIds.join(', ')}
                  </TableCell>
                </TableRow>
              )}
              {scheduleFields.map(({ name, label }) => (
                <TableRow key={name}>
                  <TableHead scope="row">{label}</TableHead>
                  <TableCell>{formatAssignmentDate(assignment[name])}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableHead scope="row">Số lượt làm tối đa</TableHead>
                <TableCell>{assignment.maxAttempts}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">Công bố lúc</TableHead>
                <TableCell>{formatAssignmentDate(assignment.publishedAt)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter>
          <div className="flex flex-wrap items-center gap-3">
            {draft ? (
              <Form method="post">
                <input type="hidden" name="intent" value="publish" />
                <Button type="submit" disabled={pending}>
                  {pending && navigation.formData?.get('intent') === 'publish' && (
                    <Spinner data-icon="inline-start" aria-label="Đang công bố" />
                  )}
                  {pending && navigation.formData?.get('intent') === 'publish'
                    ? 'Đang công bố…'
                    : 'Công bố bài giao'}
                </Button>
              </Form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to={`/assignments/${assignment.id}/delivery`} />}
                >
                  Liên kết nhận bài cho học sinh
                </Button>
                <Button
                  variant="secondary"
                  nativeButton={false}
                  render={<Link to={`/assignments/${assignment.id}/attempts`} />}
                >
                  Xem lượt làm và chấm bài
                </Button>
              </div>
            )}
            {draft && (
              <p className="text-sm text-muted-foreground">
                Công bố dùng cấu hình đã lưu và chốt học sinh đang tham gia lớp lúc đó. Hãy lưu mọi
                chỉnh sửa trước khi công bố.
              </p>
            )}
          </div>
        </CardFooter>
      </Card>

      {draft && (
        <AssignmentForm
          key={assignment.id}
          assignment={assignment}
          fieldErrors={actionData?.fieldErrors}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Người nhận</CardTitle>
          <CardDescription>
            Danh sách được chốt khi công bố; học sinh tham gia lớp sau đó không được tự động thêm.
            Thu hồi giữ lại lịch sử đã giao.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recipientsError ? (
            <Alert variant="destructive">
              <AlertDescription>{recipientsError}</AlertDescription>
            </Alert>
          ) : recipients.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Chưa có người nhận</EmptyTitle>
                <EmptyDescription>
                  {draft
                    ? 'Chưa chốt người nhận. Công bố bài giao để tạo danh sách.'
                    : 'Chưa có học sinh nhận bài.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Mã học sinh</TableHead>
                  <TableHead scope="col">Nguồn giao</TableHead>
                  <TableHead scope="col">Trạng thái</TableHead>
                  <TableHead scope="col">Giao lúc</TableHead>
                  <TableHead scope="col">Thu hồi lúc</TableHead>
                  <TableHead scope="col">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((recipient) => (
                  <TableRow key={recipient.userId}>
                    <TableCell>{recipient.userId}</TableCell>
                    <TableCell>
                      {recipient.source === 'all_class' ? 'Cả lớp' : 'Chọn học sinh'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={recipient.status === 'active' ? 'default' : 'secondary'}>
                        {recipient.status === 'active' ? 'Đang nhận bài' : 'Đã thu hồi'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatAssignmentDate(recipient.assignedAt)}</TableCell>
                    <TableCell>{formatAssignmentDate(recipient.revokedAt)}</TableCell>
                    <TableCell>
                      {recipient.status === 'active' && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="revoke" />
                          <input type="hidden" name="userId" value={recipient.userId} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="destructive"
                            disabled={pending}
                            aria-label={`Thu hồi quyền nhận bài của ${recipient.userId}`}
                          >
                            {pending && navigation.formData?.get('userId') === recipient.userId && (
                              <Spinner data-icon="inline-start" aria-label="Đang thu hồi" />
                            )}
                            {pending && navigation.formData?.get('userId') === recipient.userId
                              ? 'Đang thu hồi…'
                              : 'Thu hồi'}
                          </Button>
                        </Form>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
