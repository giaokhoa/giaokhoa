import { useId, useState } from 'react';
import { authorizationContract } from '@giaokhoa/shared/http/authorization';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@giaokhoa/ui/components/field';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import { Form } from 'react-router';
import { getAccess } from '#features/workspace/access.server.js';
import { Feedback, InputField, Page, Panel, SubmitButton } from '#features/workspace/ui.js';
import { actionError, apiData, parseInput } from '#lib/http/data.server.js';
import type { Route } from './+types/authorization';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request }: Route.LoaderArgs) {
  const access = await getAccess(request);
  if (!access.capabilities.some((key) => ['role:manage', 'role:assign_system'].includes(key)))
    throw new Response('Bạn không có quyền quản lý vai trò hệ thống.', { status: 403 });
  return {
    ...access,
    roles: access.capabilities.includes('role:manage')
      ? await apiData(
          request,
          '/authorization/roles',
          authorizationContract.listRoleContexts.responses[200],
        )
      : [],
  };
}
export async function action({ request }: Route.ActionArgs) {
  try {
    const access = await getAccess(request);
    const form = await request.formData();
    const intent = form.get('intent');
    if (intent === 'grant' || intent === 'revoke') {
      if (!access.capabilities.includes('role:assign_system'))
        throw new Response('Bạn không có quyền cấp vai trò hệ thống.', { status: 403 });
      const input = parseInput(authorizationContract.grantSystemRole.pathParams, {
        userId: form.get('userId'),
      });
      const body = parseInput(authorizationContract.grantSystemRole.body, {
        role: form.get('role'),
      });
      const result = await apiData(
        request,
        `/authorization/system-roles/${input.userId}`,
        authorizationContract.revokeSystemRole.responses[200],
        { method: intent === 'grant' ? 'POST' : 'DELETE', data: body },
      );
      return {
        success: result.changed
          ? 'Đã cập nhật vai trò hệ thống.'
          : 'Không có thay đổi đối với vai trò này.',
      };
    }
    if (!access.capabilities.includes('role:manage'))
      throw new Response('Bạn không có quyền sửa định nghĩa vai trò.', { status: 403 });
    const key = parseInput(authorizationContract.setRolePermission.pathParams, {
      roleKey: form.get('roleKey'),
    }).roleKey;
    if (intent === 'createRole') {
      const body = parseInput(authorizationContract.createRole.body, {
        key,
        contextKind: form.get('contextKind'),
        contexts: form.getAll('contexts'),
      });
      await apiData(
        request,
        '/authorization/roles',
        authorizationContract.createRole.responses[201],
        { method: 'POST', data: body },
      );
    } else if (intent === 'permission') {
      const body = parseInput(authorizationContract.setRolePermission.body, {
        capability: form.get('capability'),
        effect: form.get('effect'),
      });
      await apiData(
        request,
        `/authorization/roles/${encodeURIComponent(key)}/permissions`,
        authorizationContract.setRolePermission.responses[200],
        { method: 'PUT', data: body },
      );
    } else if (intent === 'contexts') {
      const body = parseInput(authorizationContract.setRoleContexts.body, {
        contexts: form.getAll('contexts'),
      });
      await apiData(
        request,
        `/authorization/roles/${encodeURIComponent(key)}/contexts`,
        authorizationContract.setRoleContexts.responses[200],
        { method: 'PUT', data: body },
      );
    } else if (intent === 'matrix') {
      const body = parseInput(authorizationContract.setRoleMatrix.body, {
        targetRoleKey: form.get('targetRoleKey'),
        action: form.get('action'),
        allowed: form.get('allowed') === 'true',
      });
      await apiData(
        request,
        `/authorization/roles/${encodeURIComponent(key)}/matrix`,
        authorizationContract.setRoleMatrix.responses[200],
        { method: 'PUT', data: body },
      );
    } else throw new Response('Thao tác không hợp lệ.', { status: 400 });
    return { success: 'Đã lưu cấu hình vai trò.' };
  } catch (error) {
    return actionError(error);
  }
}
const contexts = [
  ['system', 'Hệ thống'],
  ['user', 'Người dùng'],
  ['bank', 'Ngân hàng'],
  ['question', 'Câu hỏi'],
  ['exam', 'Đề thi'],
  ['class', 'Lớp học'],
  ['assignment', 'Bài giao'],
] as const;
type ContextKind = (typeof contexts)[number][0];
function ContextOptions({
  selected,
  onChange,
}: {
  selected?: ContextKind[];
  onChange?: (value: ContextKind, checked: boolean) => void;
} = {}) {
  const prefix = useId();
  return (
    <FieldSet>
      <FieldLegend>Phạm vi được phép cấp</FieldLegend>
      {contexts.map(([value, label]) => (
        <Field key={value} orientation="horizontal">
          <input
            type="checkbox"
            name="contexts"
            id={prefix + value}
            value={value}
            checked={selected ? selected.includes(value) : undefined}
            onChange={onChange ? (event) => onChange(value, event.target.checked) : undefined}
          />
          <FieldLabel htmlFor={prefix + value}>{label}</FieldLabel>
        </Field>
      ))}
    </FieldSet>
  );
}
function RoleContextsEditor({ roles }: { roles: Array<{ key: string; contexts: ContextKind[] }> }) {
  const [key, setKey] = useState(roles[0]?.key ?? '');
  const role = roles.find((item) => item.key === key);
  const [selected, setSelected] = useState<ContextKind[]>(roles[0]?.contexts ?? []);
  if (!role) return <p>Chưa có vai trò để chỉnh sửa.</p>;
  const changed = selected.slice().sort().join() !== role.contexts.slice().sort().join();
  const labels = (values: ContextKind[]) =>
    contexts
      .filter(([value]) => values.includes(value))
      .map(([, label]) => label)
      .join(', ');
  return (
    <Form
      method="post"
      onSubmit={(event) => {
        if (
          !changed ||
          !selected.length ||
          !window.confirm('Xác nhận thay đổi phạm vi cấp vai trò?')
        )
          event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="contexts" />
      <input type="hidden" name="roleKey" value={key} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="context-role">Vai trò</FieldLabel>
          <NativeSelect
            id="context-role"
            value={key}
            onChange={(event) => {
              const next = roles.find((item) => item.key === event.target.value);
              setKey(event.target.value);
              setSelected(next?.contexts ?? []);
            }}
          >
            {roles.map((item) => (
              <NativeSelectOption key={item.key} value={item.key}>
                {item.key}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <p className="text-sm">Hiện tại: {labels(role.contexts) || 'Chưa cấu hình'}</p>
        <ContextOptions
          selected={selected}
          onChange={(value, checked) =>
            setSelected((current) =>
              checked
                ? [...new Set([...current, value])]
                : current.filter((item) => item !== value),
            )
          }
        />
        <p className="text-sm">Sau khi lưu: {labels(selected) || 'Không được bỏ trống'}</p>
        <SubmitButton disabled={!changed || !selected.length}>Lưu phạm vi</SubmitButton>
      </FieldGroup>
    </Form>
  );
}
export default function Authorization({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page
      title="Phân quyền"
      description="Quản lý vai trò và quyền hệ thống. Quyền tại từng lớp được quản lý trong trang lớp học."
    >
      <Feedback {...actionData} />
      {loaderData.capabilities.includes('role:assign_system') && (
        <Panel
          title="Vai trò hệ thống"
          description="Vai trò giáo viên cho phép tạo tài nguyên riêng. Vai trò quản trị không tự cấp quyền truy cập mọi lớp."
        >
          <Form method="post">
            <FieldGroup>
              <InputField name="userId" label="Mã tài khoản" required />
              <Field>
                <FieldLabel htmlFor="role">Vai trò</FieldLabel>
                <NativeSelect id="role" name="role">
                  <NativeSelectOption value="teacher">Giáo viên</NativeSelectOption>
                  <NativeSelectOption value="admin">Quản trị viên</NativeSelectOption>
                </NativeSelect>
              </Field>
              <div className="flex gap-3">
                <SubmitButton name="intent" value="grant">
                  Cấp vai trò
                </SubmitButton>
                <SubmitButton variant="outline" name="intent" value="revoke">
                  Thu hồi vai trò
                </SubmitButton>
              </div>
            </FieldGroup>
          </Form>
        </Panel>
      )}
      {loaderData.capabilities.includes('role:manage') && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Panel title="Định nghĩa vai trò mới">
            <Form method="post">
              <input type="hidden" name="intent" value="createRole" />
              <FieldGroup>
                <InputField
                  id="new-role"
                  name="roleKey"
                  label="Khóa vai trò"
                  required
                  maxLength={120}
                />
                <Field>
                  <FieldLabel htmlFor="contextKind">Loại vai trò</FieldLabel>
                  <NativeSelect name="contextKind" id="contextKind">
                    <NativeSelectOption value="class">Lớp học</NativeSelectOption>
                    <NativeSelectOption value="system">Hệ thống</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <ContextOptions />
                <SubmitButton>Tạo vai trò</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
          <Panel title="Quyền mặc định của vai trò">
            <Form method="post">
              <input type="hidden" name="intent" value="permission" />
              <FieldGroup>
                <InputField id="permission-role" name="roleKey" label="Khóa vai trò" required />
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
                <SubmitButton>Lưu quyền</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
          <Panel title="Phạm vi của vai trò">
            <RoleContextsEditor roles={loaderData.roles} />
          </Panel>
          <Panel title="Giới hạn cấp và ghi đè vai trò">
            <Form method="post">
              <input type="hidden" name="intent" value="matrix" />
              <FieldGroup>
                <InputField
                  id="matrix-role"
                  name="roleKey"
                  label="Khóa vai trò thực hiện"
                  required
                />
                <InputField name="targetRoleKey" label="Khóa vai trò đích" required />
                <Field>
                  <FieldLabel htmlFor="matrix-action">Thao tác</FieldLabel>
                  <NativeSelect name="action" id="matrix-action">
                    <NativeSelectOption value="assign">Cấp vai trò</NativeSelectOption>
                    <NativeSelectOption value="override">Ghi đè quyền</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="allowed">Cho phép</FieldLabel>
                  <NativeSelect name="allowed" id="allowed">
                    <NativeSelectOption value="true">Có</NativeSelectOption>
                    <NativeSelectOption value="false">Không</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <SubmitButton>Lưu giới hạn</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
        </div>
      )}
    </Page>
  );
}
