import { classesContract } from '@giaokhoa/shared/http/classes';
import { Alert, AlertDescription, AlertTitle } from '@giaokhoa/ui/components/alert';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/index';
import {
  getClassAccess,
  getClassErrorStatus,
  getClassFieldErrors,
  normalizeClassDates,
} from './classes';

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return getClassAccess(session.user);
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const access = getClassAccess(session.user);
  const form = await request.formData();
  const intentValue = form.get('intent');
  const intent = typeof intentValue === 'string' ? intentValue : '';
  const fail = (error: string, status = 400, fieldErrors: Record<string, string> = {}) =>
    data({ intent, error, fieldErrors, joined: null }, { status: getClassErrorStatus(status) });

  if (intent === 'open') {
    const id = form.get('id');
    const parsed = classesContract.get.pathParams.safeParse({
      id: typeof id === 'string' ? id.trim() : '',
    });
    if (!parsed.success)
      return fail('Vui lòng kiểm tra ID lớp.', 400, getClassFieldErrors(parsed.error.issues));
    return redirect(`/classes/${parsed.data.id}`);
  }
  if (intent !== 'create' && intent !== 'join') return fail('Thao tác không hợp lệ.');
  if (intent === 'create' ? !access.canCreate : !access.canJoin) {
    return fail('Tài khoản của bạn không có quyền thực hiện thao tác này.', 403);
  }

  const endpoint = intent === 'create' ? classesContract.create : classesContract.join;
  const code = form.get('code');
  const parsed =
    intent === 'create'
      ? classesContract.create.body.safeParse({
          name: form.get('name'),
          joinMode: form.get('joinMode'),
        })
      : classesContract.join.body.safeParse({
          code: typeof code === 'string' ? code.trim() : '',
        });
  if (!parsed.success)
    return fail(
      'Vui lòng kiểm tra thông tin đã nhập.',
      400,
      getClassFieldErrors(parsed.error.issues),
    );

  try {
    const response = await createApiClient(request).request<unknown>({
      url: endpoint.path,
      method: endpoint.method,
      data: parsed.data,
    });
    if (response.status !== 201) {
      return fail(
        getApiErrorMessage(response.data) ?? 'Không thể thực hiện thao tác với lớp học.',
        response.status,
      );
    }
    if (intent === 'create') {
      const result = classesContract.create.responses[201].safeParse(
        normalizeClassDates(response.data, ['createdAt', 'updatedAt']),
      );
      if (!result.success)
        return fail(
          'Lớp đã được tạo nhưng dữ liệu trả về không hợp lệ. Hãy kiểm tra trước khi tạo lại.',
          502,
        );
      return redirect(`/classes/${result.data.id}`);
    }
    const result = classesContract.join.responses[201].safeParse(response.data);
    if (!result.success)
      return fail('Dữ liệu gia nhập lớp trả về không hợp lệ. Hãy kiểm tra trước khi thử lại.', 502);
    if (result.data.status === 'active') return redirect(`/classes/${result.data.classId}`);
    return data({ intent, error: null, fieldErrors: {}, joined: result.data });
  } catch (error) {
    return fail(
      getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ. Vui lòng thử lại.'),
      502,
    );
  }
}

export default function ClassesIndex() {
  const access = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  const currentIntent = navigation.formData?.get('intent');
  const errors = (intent: string): Record<string, string> =>
    result?.intent === intent ? result.fieldErrors : {};
  const error = (intent: string) =>
    result?.intent === intent && result.error ? <FieldError>{result.error}</FieldError> : null;

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Lớp học</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tạo không gian học tập hoặc kết nối với lớp của bạn bằng mã mời hay ID lớp.
        </p>
      </header>
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tạo lớp học</CardTitle>
            <CardDescription>
              Dành cho giáo viên và quản trị viên. Bạn sẽ là chủ lớp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {access.canCreate ? (
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <FieldGroup>
                  <Field data-invalid={!!errors('create').name}>
                    <FieldLabel htmlFor="class-name">Tên lớp</FieldLabel>
                    <Input
                      id="class-name"
                      name="name"
                      required
                      maxLength={200}
                      placeholder="Ví dụ: Toán 10A1"
                      aria-invalid={!!errors('create').name}
                      aria-describedby={errors('create').name ? 'class-name-error' : undefined}
                    />
                    <FieldError id="class-name-error">{errors('create').name}</FieldError>
                  </Field>
                  <Field data-invalid={!!errors('create').joinMode}>
                    <FieldLabel htmlFor="class-join-mode">Cách gia nhập</FieldLabel>
                    <NativeSelect
                      id="class-join-mode"
                      name="joinMode"
                      defaultValue="APPROVAL"
                      aria-invalid={!!errors('create').joinMode}
                      aria-describedby={
                        errors('create').joinMode ? 'class-join-mode-error' : undefined
                      }
                    >
                      <NativeSelectOption value="APPROVAL">Chờ chủ lớp duyệt</NativeSelectOption>
                      <NativeSelectOption value="AUTO">Tự động tham gia</NativeSelectOption>
                    </NativeSelect>
                    <FieldError id="class-join-mode-error">{errors('create').joinMode}</FieldError>
                  </Field>
                  {error('create')}
                  <Field>
                    <Button type="submit" disabled={busy}>
                      {busy && currentIntent === 'create' && (
                        <Spinner aria-label="Đang tạo lớp" data-icon="inline-start" />
                      )}
                      {busy && currentIntent === 'create' ? 'Đang tạo lớp…' : 'Tạo lớp'}
                    </Button>
                  </Field>
                </FieldGroup>
              </Form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Tài khoản hiện tại chưa có quyền tạo lớp.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Gia nhập bằng mã mời</CardTitle>
            <CardDescription>
              Nhập mã do chủ lớp chia sẻ. Một số lớp cần được duyệt trước khi vào học.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post">
              <input type="hidden" name="intent" value="join" />
              <FieldGroup>
                <Field data-invalid={!!errors('join').code} data-disabled={!access.canJoin}>
                  <FieldLabel htmlFor="join-code">Mã gia nhập</FieldLabel>
                  <Input
                    id="join-code"
                    name="code"
                    required
                    minLength={16}
                    maxLength={256}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!access.canJoin}
                    aria-invalid={!!errors('join').code}
                    aria-describedby={errors('join').code ? 'join-code-error' : undefined}
                  />
                  <FieldError id="join-code-error">{errors('join').code}</FieldError>
                </Field>
                {error('join')}
                {!access.canJoin && (
                  <p className="text-sm text-muted-foreground">
                    Tài khoản hiện tại chưa có quyền gia nhập lớp.
                  </p>
                )}
                <Field>
                  <Button type="submit" disabled={busy || !access.canJoin}>
                    {busy && currentIntent === 'join' && (
                      <Spinner aria-label="Đang gửi yêu cầu" data-icon="inline-start" />
                    )}
                    {busy && currentIntent === 'join' ? 'Đang gửi…' : 'Gia nhập lớp'}
                  </Button>
                </Field>
              </FieldGroup>
            </Form>
            {result?.joined && (
              <Alert role="status" className="mt-4">
                <AlertTitle>Yêu cầu gia nhập lớp</AlertTitle>
                <AlertDescription>
                  <p>
                    {result.joined.status === 'pending'
                      ? 'Đã gửi yêu cầu. Vui lòng chờ chủ lớp duyệt trước khi truy cập.'
                      : 'Trạng thái tham gia hiện tại chưa cho phép truy cập lớp.'}
                  </p>
                  <p className="break-all">ID lớp: {result.joined.classId}</p>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mở lớp bằng ID</CardTitle>
            <CardDescription>Nhập ID lớp bạn đã có quyền truy cập.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post">
              <input type="hidden" name="intent" value="open" />
              <FieldGroup>
                <Field data-invalid={!!errors('open').id}>
                  <FieldLabel htmlFor="class-id">ID lớp</FieldLabel>
                  <Input
                    id="class-id"
                    name="id"
                    required
                    maxLength={36}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!errors('open').id}
                    aria-describedby={errors('open').id ? 'class-id-error' : undefined}
                  />
                  <FieldError id="class-id-error">{errors('open').id}</FieldError>
                </Field>
                {error('open')}
                <Field>
                  <Button type="submit" variant="outline" disabled={busy}>
                    {busy && currentIntent === 'open' ? 'Đang mở lớp…' : 'Mở lớp'}
                  </Button>
                </Field>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Đang xử lý yêu cầu…
        </p>
      )}
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Không thể mở trang lớp học</CardTitle>
          <CardDescription>Vui lòng kiểm tra phiên đăng nhập và thử lại.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p role="alert">
              {isRouteErrorResponse(error) && typeof error.data === 'string'
                ? error.data
                : 'Không thể tải dữ liệu lớp học.'}
            </p>
            <Button render={<Link to="/classes" />} nativeButton={false} variant="outline">
              Thử lại
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
