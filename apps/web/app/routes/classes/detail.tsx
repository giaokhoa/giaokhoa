import { classesContract } from '@giaokhoa/shared/http/classes';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { authorizationContract } from '@giaokhoa/shared/http/authorization';
import { Button } from '@giaokhoa/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Form, Link, redirect } from 'react-router';
import { useState } from 'react';
import { Input } from '@giaokhoa/ui/components/input';
import { getAccess } from '#features/workspace/access.server.js';
import { classCapabilities } from '#features/workspace/access.js';
import {
  EmptyList,
  Feedback,
  InlineAction,
  InputField,
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
  const id = routeId(params.id, classesContract.get.pathParams);
  const access = await getAccess(request, { kind: 'class', resourceKey: id }, classCapabilities);
  const [classroom, members, assignments] = await Promise.all([
    apiData(request, `/classes/${id}`, classesContract.get.responses[200]),
    access.capabilities.includes('class:enrolment_manage')
      ? apiData(request, `/classes/${id}/members`, classesContract.members.responses[200])
      : [],
    apiData(request, '/assignments', assignmentsContract.list.responses[200]),
  ]);
  return {
    classroom,
    access,
    members,
    assignments: assignments.filter((item) => item.classId === id),
  };
}
export async function action({ request, params }: Route.ActionArgs) {
  try {
    const id = routeId(params.id, classesContract.get.pathParams);
    const access = await getAccess(request, { kind: 'class', resourceKey: id }, classCapabilities);
    const form = await request.formData();
    const intent = form.get('intent');
    if (intent === 'update') {
      const body = parseInput(classesContract.update.body, {
        name: form.get('name'),
        joinMode: form.get('joinMode'),
        status: form.get('status'),
      });
      await apiData(request, `/classes/${id}`, classesContract.update.responses[200], {
        method: 'PATCH',
        data: body,
      });
    } else if (intent === 'joinCode') {
      const body = parseInput(classesContract.createJoinCode.body, {
        expiresInHours: Number(form.get('expiresInHours')),
        ...(form.get('maxUses') ? { maxUses: Number(form.get('maxUses')) } : {}),
      });
      const joinCode = await apiData(
        request,
        `/classes/${id}/join-codes`,
        classesContract.createJoinCode.responses[201],
        { method: 'POST', data: body },
      );
      return {
        joinCode,
        success: 'Mã tham gia chỉ hiển thị lần này. Hãy sao chép trước khi rời trang.',
      };
    } else if (intent === 'revokeCode') {
      const input = parseInput(classesContract.revokeJoinCode.pathParams, {
        id,
        codeId: form.get('codeId'),
      });
      await apiData(request, `/classes/${id}/join-codes/${input.codeId}`, null, {
        method: 'DELETE',
      });
    } else if (intent === 'approve' || intent === 'suspend') {
      const input = parseInput(classesContract.approve.pathParams, {
        id,
        userId: form.get('userId'),
      });
      await apiData(
        request,
        `/classes/${id}/members/${input.userId}/${intent}`,
        classesContract.approve.responses[200],
        { method: 'POST' },
      );
    } else if (intent === 'leave') {
      await apiData(request, `/classes/${id}/leave`, null, { method: 'POST' });
      return redirect('/classes');
    } else if (intent === 'grantRole' || intent === 'revokeRole') {
      const input = parseInput(authorizationContract.grantContextRole.pathParams, {
        contextId: access.contextId,
        userId: form.get('userId'),
      });
      const body = parseInput(authorizationContract.grantContextRole.body, {
        roleKey: form.get('roleKey'),
      });
      await apiData(
        request,
        `/authorization/contexts/${input.contextId}/roles/${input.userId}`,
        authorizationContract.revokeContextRole.responses[200],
        { method: intent === 'grantRole' ? 'POST' : 'DELETE', data: body },
      );
    } else if (intent === 'overrideRole') {
      const body = parseInput(authorizationContract.overrideRole.body, {
        roleKey: form.get('roleKey'),
        capability: form.get('capability'),
        effect: form.get('effect'),
      });
      await apiData(
        request,
        `/authorization/contexts/${access.contextId}/overrides`,
        authorizationContract.overrideRole.responses[200],
        { method: 'PUT', data: body },
      );
    } else throw new Response('Thao tác không hợp lệ.', { status: 400 });
    return { success: 'Đã cập nhật lớp học.' };
  } catch (error) {
    return actionError(error);
  }
}
export default function ClassDetail({
  loaderData: { classroom, access, members, assignments },
  actionData,
}: Route.ComponentProps) {
  const can = (key: string) => access.capabilities.includes(key);
  const joinCode = actionData && 'joinCode' in actionData ? actionData.joinCode : undefined;
  const [memberSearch, setMemberSearch] = useState('');
  const visibleMembers = members.filter((member) =>
    [member.name, member.email, member.userId].some((value) =>
      value?.toLocaleLowerCase('vi-VN').includes(memberSearch.trim().toLocaleLowerCase('vi-VN')),
    ),
  );
  return (
    <Page
      title={classroom.name}
      description={`Mã lớp: ${classroom.id}`}
      actions={<Status value={classroom.status} />}
    >
      <Feedback {...actionData} />
      <div className="flex flex-wrap gap-3">
        {can('assignment:create') && (
          <Button
            nativeButton={false}
            render={<Link to={`/assignments/new?classId=${classroom.id}`} />}
          >
            Giao bài mới
          </Button>
        )}
        {can('assignment:attempt') && (
          <InlineAction
            intent="leave"
            label="Rời lớp"
            confirm="Rời lớp sẽ thu hồi quyền truy cập lớp và bài giao. Bạn có muốn tiếp tục?"
          />
        )}
      </div>
      <nav aria-label="Mục của lớp" className="flex flex-wrap gap-4 text-sm">
        <a className="underline" href="#class-assignments">
          Bài giao
        </a>
        {can('class:enrolment_manage') && (
          <a className="underline" href="#class-members">
            Thành viên
          </a>
        )}
        {can('class:update') && (
          <a className="underline" href="#class-settings">
            Thiết lập
          </a>
        )}
      </nav>
      <section id="class-assignments">
        <Panel title="Bài giao của lớp">
          {!assignments.length ? (
            <EmptyList />
          ) : (
            <ul className="flex flex-col gap-3">
              {assignments.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3">
                  <Link to={`/assignments/${item.id}`} className="underline underline-offset-4">
                    {item.title}
                  </Link>
                  <Status value={item.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
      {can('class:update') && (
        <div id="class-settings" className="grid items-start gap-6 lg:grid-cols-2">
          <Panel title="Thông tin lớp">
            <Form method="post">
              <input type="hidden" name="intent" value="update" />
              <FieldGroup>
                <InputField
                  name="name"
                  label="Tên lớp"
                  defaultValue={classroom.name}
                  required
                  maxLength={200}
                />
                <Field>
                  <FieldLabel htmlFor="joinMode">Cách tham gia</FieldLabel>
                  <NativeSelect id="joinMode" name="joinMode" defaultValue={classroom.joinMode}>
                    <NativeSelectOption value="APPROVAL">Cần phê duyệt</NativeSelectOption>
                    <NativeSelectOption value="AUTO">Tự động</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="status">Trạng thái</FieldLabel>
                  <NativeSelect id="status" name="status" defaultValue={classroom.status}>
                    <NativeSelectOption value="active">Đang hoạt động</NativeSelectOption>
                    <NativeSelectOption value="archived">Đã lưu trữ</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <SubmitButton>Lưu thông tin</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
          <Panel title="Mã tham gia" description="Tạo mã có thời hạn và giới hạn số người sử dụng.">
            <Form method="post">
              <input type="hidden" name="intent" value="joinCode" />
              <FieldGroup>
                <InputField
                  name="expiresInHours"
                  label="Hiệu lực (giờ)"
                  type="number"
                  min={1}
                  max={720}
                  defaultValue={24}
                  required
                />
                <InputField
                  name="maxUses"
                  label="Số lượt dùng tối đa (để trống nếu không giới hạn)"
                  type="number"
                  min={1}
                />
                <SubmitButton disabled={classroom.status !== 'active'}>
                  Tạo mã tham gia
                </SubmitButton>
              </FieldGroup>
            </Form>
            {joinCode && (
              <div className="mt-5 flex flex-col gap-3">
                <InputField
                  name="generatedCode"
                  label="Mã vừa tạo"
                  value={joinCode.code}
                  readOnly
                />
                <p className="text-sm text-muted-foreground">
                  Hết hạn: {formatDate(joinCode.expiresAt)}
                </p>
                <InlineAction
                  intent="revokeCode"
                  label="Thu hồi mã vừa tạo"
                  fields={{ codeId: joinCode.id }}
                  confirm="Thu hồi mã tham gia này?"
                />
              </div>
            )}
          </Panel>
        </div>
      )}
      {can('class:enrolment_manage') && (
        <div id="class-members">
          <Panel title="Thành viên">
            <Input
              aria-label="Tìm thành viên theo tên hoặc tài khoản"
              placeholder="Tìm theo tên hoặc email"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
            {!visibleMembers.length ? (
              <EmptyList>
                {memberSearch ? 'Không tìm thấy thành viên.' : 'Chưa có học sinh tham gia lớp.'}
              </EmptyList>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Người học</TableHead>
                    <TableHead>Vai trò</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Tham gia lúc</TableHead>
                    <TableHead>Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMembers.map((member) => (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div>{member.name ?? member.userId}</div>
                        {member.email && (
                          <div className="text-sm text-muted-foreground">{member.email}</div>
                        )}
                      </TableCell>
                      <TableCell>{member.roles?.join(', ') || 'Chưa cấp'}</TableCell>
                      <TableCell>
                        <Status value={member.status} />
                      </TableCell>
                      <TableCell>{formatDate(member.joinedAt)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {member.status === 'pending' && (
                            <InlineAction
                              intent="approve"
                              label="Duyệt"
                              fields={{ userId: member.userId }}
                            />
                          )}
                          {(member.status === 'active' || member.status === 'pending') && (
                            <InlineAction
                              intent="suspend"
                              label="Đình chỉ"
                              fields={{ userId: member.userId }}
                              confirm="Đình chỉ sẽ thu hồi quyền học tại lớp. Tiếp tục?"
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      )}
      {can('role:assign') && (
        <Panel
          title="Cấp hoặc thu hồi vai trò trong lớp"
          description="Nhập mã tài khoản và khóa vai trò. Hệ thống kiểm tra vai trò bạn được phép cấp trong lớp này."
        >
          <Form method="post">
            <FieldGroup>
              <InputField name="userId" label="Mã tài khoản" required />
              <InputField
                name="roleKey"
                label="Khóa vai trò"
                defaultValue="class:student"
                required
              />
              <div className="flex gap-3">
                <SubmitButton name="intent" value="grantRole">
                  Cấp vai trò
                </SubmitButton>
                <SubmitButton name="intent" value="revokeRole" variant="outline">
                  Thu hồi vai trò
                </SubmitButton>
              </div>
            </FieldGroup>
          </Form>
        </Panel>
      )}
      {can('role:override') && (
        <Panel
          title="Điều chỉnh quyền tại lớp"
          description="Thay đổi chỉ áp dụng tại lớp này; quyền cấp vai trò và giới hạn ghi đè vẫn do API kiểm tra."
        >
          <Form method="post">
            <input type="hidden" name="intent" value="overrideRole" />
            <FieldGroup>
              <InputField id="override-role" name="roleKey" label="Khóa vai trò" required />
              <InputField name="capability" label="Khóa quyền" required />
              <Field>
                <FieldLabel htmlFor="effect">Tác động</FieldLabel>
                <NativeSelect name="effect" id="effect">
                  <NativeSelectOption value="INHERIT">Kế thừa</NativeSelectOption>
                  <NativeSelectOption value="ALLOW">Cho phép</NativeSelectOption>
                  <NativeSelectOption value="PREVENT">Ngăn</NativeSelectOption>
                  <NativeSelectOption value="PROHIBIT">Cấm tuyệt đối</NativeSelectOption>
                </NativeSelect>
              </Field>
              <SubmitButton>Lưu quyền tại lớp</SubmitButton>
            </FieldGroup>
          </Form>
        </Panel>
      )}
    </Page>
  );
}
