import { classesContract } from '@giaokhoa/shared/http/classes';
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
import { getAccess, requireCapability } from '#features/workspace/access.server.js';
import {
  EmptyList,
  Feedback,
  InputField,
  Page,
  Panel,
  Status,
  SubmitButton,
} from '#features/workspace/ui.js';
import { actionError, apiData, parseInput } from '#lib/http/data.server.js';
import type { Route } from './+types/index';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';

export async function loader({ request }: Route.LoaderArgs) {
  const access = await getAccess(request);
  return {
    access,
    classes: await apiData(request, classesContract.list.path, classesContract.list.responses[200]),
  };
}
export async function action({ request }: Route.ActionArgs) {
  try {
    const form = await request.formData();
    if (form.get('intent') === 'create') {
      await requireCapability(request, 'class:create');
      const body = parseInput(classesContract.create.body, {
        name: form.get('name'),
        joinMode: form.get('joinMode'),
      });
      const classroom = await apiData(
        request,
        classesContract.create.path,
        classesContract.create.responses[201],
        { method: 'POST', data: body },
      );
      return redirect(`/classes/${classroom.id}`);
    }
    if (form.get('intent') === 'join') {
      await requireCapability(request, 'class:join');
      const body = parseInput(classesContract.join.body, {
        code: typeof form.get('code') === 'string' ? (form.get('code') as string).trim() : null,
      });
      const result = await apiData(
        request,
        classesContract.join.path,
        classesContract.join.responses[201],
        { method: 'POST', data: body },
      );
      if (result.status === 'active') return redirect(`/classes/${result.classId}`);
      return { success: 'Đã gửi yêu cầu tham gia. Bạn sẽ thấy lớp sau khi được duyệt.' };
    }
    throw new Response('Thao tác không hợp lệ.', { status: 400 });
  } catch (error) {
    return actionError(error);
  }
}
export default function Classes({
  loaderData: { access, classes },
  actionData,
}: Route.ComponentProps) {
  return (
    <Page title="Lớp học" description="Các lớp bạn được phép truy cập và quản lý.">
      <Feedback {...actionData} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {access.capabilities.includes('class:create') && (
          <Panel title="Tạo lớp học">
            <Form method="post">
              <input type="hidden" name="intent" value="create" />
              <FieldGroup>
                <InputField label="Tên lớp" name="name" required maxLength={200} />
                <Field>
                  <FieldLabel htmlFor="joinMode">Cách tham gia</FieldLabel>
                  <NativeSelect id="joinMode" name="joinMode" defaultValue="APPROVAL">
                    <NativeSelectOption value="APPROVAL">Cần phê duyệt</NativeSelectOption>
                    <NativeSelectOption value="AUTO">Tự động tham gia</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <SubmitButton>Tạo lớp</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
        )}
        {access.capabilities.includes('class:join') && (
          <Panel title="Tham gia lớp" description="Nhập mã tham gia do giáo viên cung cấp.">
            <Form method="post">
              <input type="hidden" name="intent" value="join" />
              <FieldGroup>
                <InputField
                  label="Mã tham gia"
                  name="code"
                  autoComplete="off"
                  required
                  minLength={16}
                  maxLength={256}
                />
                <SubmitButton>Tham gia lớp</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
        )}
      </div>
      <Panel title="Lớp của bạn">
        {!classes.length ? (
          <EmptyList>Tham gia hoặc tạo lớp để bắt đầu.</EmptyList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên lớp</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Tham gia</TableHead>
                <TableHead>
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>
                    <Status value={item.status} />
                  </TableCell>
                  <TableCell>{item.joinMode === 'AUTO' ? 'Tự động' : 'Phê duyệt'}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link to={`/classes/${item.id}`} />}
                    >
                      Mở lớp
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
