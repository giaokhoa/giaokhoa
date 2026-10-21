import type { ClassEnrolment } from '@giaokhoa/shared/classes';
import { classesContract } from '@giaokhoa/shared/http/classes';
import { Alert, AlertDescription, AlertTitle } from '@giaokhoa/ui/components/alert';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  useRouteError,
} from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/detail';
import {
  canChangeClassMember,
  formatClassDate,
  getClassAccess,
  getClassErrorStatus,
  getClassFieldErrors,
  normalizeClassDates,
} from './classes';

async function readClass(request: Request, id: string) {
  const response = await createApiClient(request).request<unknown>({
    url: classesContract.get.path.replace(':id', id),
    method: classesContract.get.method,
  });
  if (response.status !== 200)
    throw new Response(getApiErrorMessage(response.data) ?? 'Không thể tải lớp học.', {
      status: getClassErrorStatus(response.status),
    });
  const result = classesContract.get.responses[200].safeParse(
    normalizeClassDates(response.data, ['createdAt', 'updatedAt']),
  );
  if (!result.success) throw new Response('Dữ liệu lớp học trả về không hợp lệ.', { status: 502 });
  return result.data;
}

async function readMembers(request: Request, id: string) {
  const response = await createApiClient(request).request<unknown>({
    url: classesContract.members.path.replace(':id', id),
    method: classesContract.members.method,
  });
  if (response.status !== 200)
    throw new Response(getApiErrorMessage(response.data) ?? 'Không thể tải thành viên lớp.', {
      status: getClassErrorStatus(response.status),
    });
  const result = classesContract.members.responses[200].safeParse(
    Array.isArray(response.data)
      ? response.data.map((member) => normalizeClassDates(member, ['joinedAt', 'updatedAt']))
      : response.data,
  );
  if (!result.success)
    throw new Response('Dữ liệu thành viên trả về không hợp lệ.', { status: 502 });
  return result.data;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const parsed = classesContract.get.pathParams.safeParse({ id: params.id });
  if (!parsed.success) throw new Response('ID lớp không hợp lệ.', { status: 400 });
  try {
    const classroom = await readClass(request, parsed.data.id);
    const access = getClassAccess(session.user, classroom.createdByUserId);
    let members: ClassEnrolment[] | null = null;
    let membersError: string | null = null;
    if (access.canManage) {
      try {
        members = await readMembers(request, classroom.id);
      } catch (error) {
        membersError =
          error instanceof Response
            ? await error.text()
            : getRequestErrorMessage(error, 'Không thể tải thành viên lớp.');
      }
    }
    return {
      classroom,
      access: { ...access, canManage: access.canManage && members !== null },
      members,
      membersError,
      viewerId: session.user.id,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  const intentValue = form.get('intent');
  const intent = typeof intentValue === 'string' ? intentValue : '';
  const fail = (error: string, status = 400, fieldErrors: Record<string, string> = {}) =>
    data(
      { error, fieldErrors, message: null, joinCode: null },
      { status: getClassErrorStatus(status) },
    );
  const parsedId = classesContract.get.pathParams.safeParse({ id: params.id });
  if (!parsedId.success) return fail('ID lớp không hợp lệ.');
  if (!['update', 'invite', 'approve', 'suspend', 'leave'].includes(intent))
    return fail('Thao tác không hợp lệ.');

  try {
    const api = createApiClient(request);
    if (intent === 'leave') {
      if (form.get('confirm') !== 'yes') return fail('Vui lòng xác nhận rời lớp.');
      const response = await api.request<unknown>({
        url: classesContract.leave.path.replace(':id', parsedId.data.id),
        method: classesContract.leave.method,
      });
      if (response.status !== 204)
        return fail(getApiErrorMessage(response.data) ?? 'Không thể rời lớp.', response.status);
      return redirect('/classes');
    }
    const classroom = await readClass(request, parsedId.data.id);
    const access = getClassAccess(session.user, classroom.createdByUserId);
    if (!access.canManage) return fail('Bạn không có quyền quản lý lớp này.', 403);
    // Xác nhận quyền quản lý từ API trước khi nhận thao tác của biểu mẫu.
    const members = await readMembers(request, classroom.id);
    if (intent === 'update') {
      const parsed = classesContract.update.body.safeParse({
        name: form.get('name'),
        joinMode: form.get('joinMode'),
        status: form.get('status'),
      });
      if (!parsed.success)
        return fail(
          'Vui lòng kiểm tra thông tin lớp.',
          400,
          getClassFieldErrors(parsed.error.issues),
        );
      const response = await api.request<unknown>({
        url: classesContract.update.path.replace(':id', classroom.id),
        method: classesContract.update.method,
        data: parsed.data,
      });
      if (response.status !== 200)
        return fail(
          getApiErrorMessage(response.data) ?? 'Không thể cập nhật lớp.',
          response.status,
        );
      const result = classesContract.update.responses[200].safeParse(
        normalizeClassDates(response.data, ['createdAt', 'updatedAt']),
      );
      if (!result.success)
        return fail(
          'Yêu cầu đã được xử lý nhưng thông tin lớp trả về không hợp lệ. Vui lòng tải lại trang.',
          502,
        );
      return data({
        error: null,
        fieldErrors: {},
        message: 'Đã lưu thông tin lớp.',
        joinCode: null,
      });
    }
    if (intent === 'invite') {
      if (classroom.status !== 'active')
        return fail('Chỉ có thể tạo mã mời khi lớp đang hoạt động.', 409);
      const maxUses = form.get('maxUses');
      const parsed = classesContract.createJoinCode.body.safeParse({
        expiresInHours: Number(form.get('expiresInHours')),
        ...(maxUses === '' || maxUses === null ? {} : { maxUses: Number(maxUses) }),
      });
      if (!parsed.success)
        return fail(
          'Vui lòng kiểm tra giới hạn của mã mời.',
          400,
          getClassFieldErrors(parsed.error.issues),
        );
      const response = await api.request<unknown>({
        url: classesContract.createJoinCode.path.replace(':id', classroom.id),
        method: classesContract.createJoinCode.method,
        data: parsed.data,
      });
      if (response.status !== 201)
        return fail(getApiErrorMessage(response.data) ?? 'Không thể tạo mã mời.', response.status);
      const result = classesContract.createJoinCode.responses[201].safeParse(
        normalizeClassDates(response.data, ['expiresAt']),
      );
      if (!result.success)
        return fail(
          'Mã mời đã được tạo nhưng dữ liệu trả về không hợp lệ. Vui lòng kiểm tra trước khi tạo lại.',
          502,
        );
      return data({
        error: null,
        fieldErrors: {},
        message: 'Đã tạo mã mời.',
        joinCode: result.data,
      });
    }
    const memberIntent = intent === 'approve' ? 'approve' : 'suspend';
    const endpoint = classesContract[memberIntent];
    const parsed = endpoint.pathParams.safeParse({ id: classroom.id, userId: form.get('userId') });
    if (!parsed.success) return fail('ID thành viên không hợp lệ.');
    if (parsed.data.userId === session.user.id || parsed.data.userId === classroom.createdByUserId)
      return fail('Không thể thực hiện thao tác này với chủ lớp hoặc chính mình.', 403);
    const member = members.find((item) => item.userId === parsed.data.userId);
    if (!member || !canChangeClassMember(memberIntent, classroom.status, member.status))
      return fail('Trạng thái thành viên không còn phù hợp. Vui lòng tải lại danh sách.', 409);
    const response = await api.request<unknown>({
      url: endpoint.path.replace(':id', classroom.id).replace(':userId', parsed.data.userId),
      method: endpoint.method,
    });
    if (response.status !== 200)
      return fail(
        getApiErrorMessage(response.data) ?? 'Không thể cập nhật thành viên.',
        response.status,
      );
    const result = endpoint.responses[200].safeParse(
      normalizeClassDates(response.data, ['joinedAt', 'updatedAt']),
    );
    if (!result.success)
      return fail(
        'Yêu cầu đã được xử lý nhưng dữ liệu thành viên trả về không hợp lệ. Vui lòng tải lại danh sách.',
        502,
      );
    return data({
      error: null,
      fieldErrors: {},
      message: memberIntent === 'approve' ? 'Đã duyệt thành viên.' : 'Đã đình chỉ thành viên.',
      joinCode: null,
    });
  } catch (error) {
    if (error instanceof Response) return fail(await error.text(), error.status);
    return fail(
      getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ. Vui lòng thử lại.'),
      502,
    );
  }
}

const memberStatusLabels = {
  pending: 'Chờ duyệt',
  active: 'Đang học',
  suspended: 'Đình chỉ',
  left: 'Đã rời lớp',
};

function MemberRow({
  member,
  classroom,
  viewerId,
}: {
  member: ClassEnrolment;
  classroom: Awaited<ReturnType<typeof loader>>['classroom'];
  viewerId: string;
}) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== 'idle';
  const canAct = member.userId !== viewerId && member.userId !== classroom.createdByUserId;
  return (
    <TableRow>
      <TableCell>{member.userId}</TableCell>
      <TableCell>
        <Badge variant={member.status === 'suspended' ? 'destructive' : 'secondary'}>
          {memberStatusLabels[member.status]}
        </Badge>
      </TableCell>
      <TableCell>{formatClassDate(member.joinedAt)}</TableCell>
      <TableCell>
        <fetcher.Form method="post" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={member.userId} />
          {canAct && canChangeClassMember('approve', classroom.status, member.status) && (
            <Button type="submit" size="sm" name="intent" value="approve" disabled={busy}>
              Duyệt
            </Button>
          )}
          {canAct && canChangeClassMember('suspend', classroom.status, member.status) && (
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              name="intent"
              value="suspend"
              disabled={busy}
            >
              Đình chỉ
            </Button>
          )}
          {busy && (
            <span role="status">
              <Spinner aria-label="Đang xử lý" />
              Đang xử lý…
            </span>
          )}
          {!busy && fetcher.data?.error && <FieldError>{fetcher.data.error}</FieldError>}
          {!busy && fetcher.data?.message && <span role="status">{fetcher.data.message}</span>}
        </fetcher.Form>
      </TableCell>
    </TableRow>
  );
}

function LeaveClassForm() {
  const leave = useFetcher<typeof action>();
  return (
    <leave.Form method="post">
      <input type="hidden" name="intent" value="leave" />
      <FieldGroup>
        <Field orientation="horizontal">
          <input id="confirm-leave" type="checkbox" name="confirm" value="yes" required />
          <FieldLabel htmlFor="confirm-leave">
            Tôi xác nhận muốn rời lớp hoặc hủy yêu cầu gia nhập
          </FieldLabel>
        </Field>
        <FieldError>{leave.data?.error}</FieldError>
        <Field>
          <Button type="submit" variant="destructive" disabled={leave.state !== 'idle'}>
            {leave.state !== 'idle' && (
              <Spinner aria-label="Đang rời lớp" data-icon="inline-start" />
            )}
            {leave.state !== 'idle' ? 'Đang xử lý…' : 'Xác nhận rời lớp'}
          </Button>
        </Field>
      </FieldGroup>
    </leave.Form>
  );
}

export default function ClassDetail() {
  const { classroom, access, members, membersError, viewerId } = useLoaderData<typeof loader>();
  const edit = useFetcher<typeof action>();
  const invite = useFetcher<typeof action>();
  const editErrors: Record<string, string> = edit.data?.fieldErrors ?? {};
  const inviteErrors: Record<string, string> = invite.data?.fieldErrors ?? {};
  const archived = classroom.status === 'archived';
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <header className="flex flex-col items-start gap-3">
        <Button render={<Link to="/classes" />} nativeButton={false} variant="outline" size="sm">
          Về lớp học
        </Button>
        <h1 className="text-2xl font-semibold">{classroom.name}</h1>
        <p className="text-sm break-all text-muted-foreground">ID lớp: {classroom.id}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Trạng thái lớp</CardDescription>
            <CardTitle>{archived ? 'Đã lưu trữ' : 'Đang hoạt động'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Cách gia nhập</CardDescription>
            <CardTitle>
              {classroom.joinMode === 'AUTO' ? 'Tự động tham gia' : 'Chờ chủ lớp duyệt'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Vai trò của bạn</CardDescription>
            <CardTitle>{access.isOwner ? 'Chủ lớp' : 'Thành viên'}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      {membersError && (
        <Alert variant="destructive">
          <AlertTitle>Chưa thể xác nhận quyền quản lý</AlertTitle>
          <AlertDescription>
            {membersError} Vui lòng tải lại trang để thử tải danh sách thành viên.
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="information">
        <TabsList aria-label="Nội dung lớp học">
          <TabsTrigger value="information">Thông tin</TabsTrigger>
          {access.canManage && (
            <TabsTrigger value="members">Thành viên ({members?.length ?? 0})</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="information" className="mt-4">
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Thông tin lớp</CardTitle>
                <CardDescription>
                  {access.canManage
                    ? 'Cập nhật tên, cách gia nhập và trạng thái lớp.'
                    : 'Thông tin do chủ lớp quản lý.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {access.canManage ? (
                  <edit.Form method="post">
                    <input type="hidden" name="intent" value="update" />
                    <FieldGroup>
                      <Field data-invalid={!!editErrors.name}>
                        <FieldLabel htmlFor="edit-class-name">Tên lớp</FieldLabel>
                        <Input
                          id="edit-class-name"
                          name="name"
                          defaultValue={classroom.name}
                          required
                          maxLength={200}
                          aria-invalid={!!editErrors.name}
                          aria-describedby={editErrors.name ? 'edit-class-name-error' : undefined}
                        />
                        <FieldError id="edit-class-name-error">{editErrors.name}</FieldError>
                      </Field>
                      <Field data-invalid={!!editErrors.joinMode}>
                        <FieldLabel htmlFor="edit-join-mode">Cách gia nhập</FieldLabel>
                        <NativeSelect
                          id="edit-join-mode"
                          name="joinMode"
                          defaultValue={classroom.joinMode}
                          aria-invalid={!!editErrors.joinMode}
                          aria-describedby={
                            editErrors.joinMode ? 'edit-join-mode-error' : undefined
                          }
                        >
                          <NativeSelectOption value="APPROVAL">
                            Chờ chủ lớp duyệt
                          </NativeSelectOption>
                          <NativeSelectOption value="AUTO">Tự động tham gia</NativeSelectOption>
                        </NativeSelect>
                        <FieldError id="edit-join-mode-error">{editErrors.joinMode}</FieldError>
                      </Field>
                      <Field data-invalid={!!editErrors.status}>
                        <FieldLabel htmlFor="edit-class-status">Trạng thái</FieldLabel>
                        <NativeSelect
                          id="edit-class-status"
                          name="status"
                          defaultValue={classroom.status}
                          aria-invalid={!!editErrors.status}
                          aria-describedby="class-status-help class-status-error"
                        >
                          <NativeSelectOption value="active">Đang hoạt động</NativeSelectOption>
                          <NativeSelectOption value="archived">Đã lưu trữ</NativeSelectOption>
                        </NativeSelect>
                        <FieldDescription id="class-status-help">
                          Lưu trữ sẽ ngừng quyền truy cập của học sinh, tạo mã mời và duyệt thành
                          viên.
                        </FieldDescription>
                        <FieldError id="class-status-error">{editErrors.status}</FieldError>
                      </Field>
                      <FieldError>{edit.data?.error}</FieldError>
                      {edit.state === 'idle' && edit.data?.message && (
                        <p role="status">{edit.data.message}</p>
                      )}
                      <Field>
                        <Button type="submit" disabled={edit.state !== 'idle'}>
                          {edit.state !== 'idle' && (
                            <Spinner aria-label="Đang lưu" data-icon="inline-start" />
                          )}
                          {edit.state !== 'idle' ? 'Đang lưu…' : 'Lưu thông tin'}
                        </Button>
                      </Field>
                    </FieldGroup>
                  </edit.Form>
                ) : (
                  <dl className="flex flex-col gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Ngày tạo</dt>
                      <dd>{formatClassDate(classroom.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Cập nhật gần nhất</dt>
                      <dd>{formatClassDate(classroom.updatedAt)}</dd>
                    </div>
                  </dl>
                )}
              </CardContent>
            </Card>
            {access.canManage && (
              <Card>
                <CardHeader>
                  <CardTitle>Mời vào lớp</CardTitle>
                  <CardDescription>
                    Mã chỉ hiển thị sau khi tạo. Hãy lưu lại để chia sẻ với người học.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-6">
                    {archived ? (
                      <p className="text-sm text-muted-foreground">Mở lại lớp để tạo mã mời mới.</p>
                    ) : (
                      <invite.Form method="post">
                        <input type="hidden" name="intent" value="invite" />
                        <FieldGroup>
                          <Field data-invalid={!!inviteErrors.expiresInHours}>
                            <FieldLabel htmlFor="invite-hours">Thời hạn (giờ)</FieldLabel>
                            <Input
                              id="invite-hours"
                              name="expiresInHours"
                              type="number"
                              min={1}
                              max={720}
                              step={1}
                              required
                              defaultValue={24}
                              aria-invalid={!!inviteErrors.expiresInHours}
                              aria-describedby="invite-hours-error"
                            />
                            <FieldError id="invite-hours-error">
                              {inviteErrors.expiresInHours}
                            </FieldError>
                          </Field>
                          <Field data-invalid={!!inviteErrors.maxUses}>
                            <FieldLabel htmlFor="invite-max-uses">Số lượt dùng tối đa</FieldLabel>
                            <Input
                              id="invite-max-uses"
                              name="maxUses"
                              type="number"
                              min={1}
                              step={1}
                              aria-invalid={!!inviteErrors.maxUses}
                              aria-describedby="invite-max-uses-help invite-max-uses-error"
                            />
                            <FieldDescription id="invite-max-uses-help">
                              Để trống nếu không giới hạn số lượt.
                            </FieldDescription>
                            <FieldError id="invite-max-uses-error">
                              {inviteErrors.maxUses}
                            </FieldError>
                          </Field>
                          <FieldError>{invite.data?.error}</FieldError>
                          <Field>
                            <Button type="submit" disabled={invite.state !== 'idle'}>
                              {invite.state !== 'idle' && (
                                <Spinner aria-label="Đang tạo mã" data-icon="inline-start" />
                              )}
                              {invite.state !== 'idle' ? 'Đang tạo mã…' : 'Tạo mã mời'}
                            </Button>
                          </Field>
                        </FieldGroup>
                      </invite.Form>
                    )}
                    {invite.data?.joinCode && (
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="created-invite-code">Mã mời vừa tạo</FieldLabel>
                          <Input
                            id="created-invite-code"
                            readOnly
                            value={invite.data.joinCode.code}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <FieldDescription role="status">
                            Hết hạn lúc {formatClassDate(invite.data.joinCode.expiresAt)} (giờ Việt
                            Nam). Mã sẽ mất khỏi trang khi tải lại.
                          </FieldDescription>
                        </Field>
                      </FieldGroup>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
            {!access.isOwner && (
              <Card>
                <CardHeader>
                  <CardTitle>Rời lớp</CardTitle>
                  <CardDescription>
                    Bạn sẽ mất quyền truy cập lớp. Muốn tham gia lại, bạn cần mã mời còn hiệu lực và
                    có thể phải chờ duyệt.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LeaveClassForm />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        {access.canManage && (
          <TabsContent value="members" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Thành viên lớp</CardTitle>
                <CardDescription>
                  Duyệt yêu cầu đang chờ hoặc đình chỉ người đang học và người chờ duyệt.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <caption className="mt-4 text-sm text-muted-foreground">
                    Thời gian hiển thị theo giờ Việt Nam. Thành viên được nhận diện bằng ID.
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID thành viên</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Ngày gia nhập</TableHead>
                      <TableHead>Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members?.length ? (
                      members.map((member) => (
                        <MemberRow
                          key={member.userId}
                          member={member}
                          classroom={classroom}
                          viewerId={viewerId}
                        />
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Empty>
                            <EmptyHeader>
                              <EmptyTitle>Chưa có thành viên</EmptyTitle>
                              <EmptyDescription>
                                Hãy chia sẻ mã mời để người học gia nhập lớp.
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main className="p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {status === 403
              ? 'Bạn chưa có quyền truy cập lớp'
              : status === 404
                ? 'Không tìm thấy lớp'
                : 'Không thể tải lớp học'}
          </CardTitle>
          <CardDescription>
            {status === 403
              ? 'Nếu vừa gửi yêu cầu gia nhập, hãy chờ chủ lớp duyệt. Lớp đã lưu trữ hoặc quan hệ tham gia không còn hiệu lực cũng có thể làm mất quyền truy cập.'
              : 'Kiểm tra ID lớp và thử lại.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p role="alert">
              {isRouteErrorResponse(error) && typeof error.data === 'string'
                ? error.data
                : 'Không thể kết nối đến máy chủ.'}
            </p>
            <Button render={<Link to="/classes" />} nativeButton={false} variant="outline">
              Về lớp học
            </Button>
            {status === 403 && (
              <details>
                <summary>Rời lớp hoặc hủy yêu cầu gia nhập</summary>
                <div className="mt-4 flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                    Nếu đã gia nhập hoặc đang chờ duyệt, bạn có thể yêu cầu rời lớp. Người bị đình
                    chỉ không thể tự rời lớp.
                  </p>
                  <LeaveClassForm />
                </div>
              </details>
            )}
            <Form method="get">
              <Button type="submit" variant="outline">
                Thử lại
              </Button>
            </Form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
