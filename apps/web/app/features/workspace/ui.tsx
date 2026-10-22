import type { ReactNode, ComponentProps } from 'react';
import {
  Form,
  isRouteErrorResponse,
  Link,
  useNavigation,
  useRevalidator,
  useRouteError,
} from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@giaokhoa/ui/components/alert';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Spinner } from '@giaokhoa/ui/components/spinner';

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  );
}
export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function InputField({
  label,
  ...props
}: ComponentProps<typeof Input> & { label: string; name: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id ?? props.name}>{label}</FieldLabel>
      <Input id={props.id ?? props.name} {...props} />
    </Field>
  );
}
export function SubmitButton({ children, ...props }: ComponentProps<typeof Button>) {
  const navigation = useNavigation();
  return (
    <Button type="submit" {...props} disabled={props.disabled || navigation.state !== 'idle'}>
      {navigation.state !== 'idle' && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  );
}
export function Feedback({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <Alert variant={error ? 'destructive' : 'default'} role={error ? 'alert' : 'status'}>
      <AlertTitle>{error ? 'Không thể hoàn tất' : 'Đã cập nhật'}</AlertTitle>
      <AlertDescription>{error ?? success}</AlertDescription>
    </Alert>
  );
}
export function EmptyList({
  children = 'Danh sách sẽ xuất hiện khi có dữ liệu.',
}: {
  children?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Chưa có dữ liệu</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
const statuses: Record<string, string> = {
  active: 'Đang hoạt động',
  archived: 'Đã lưu trữ',
  pending: 'Chờ duyệt',
  suspended: 'Đã đình chỉ',
  left: 'Đã rời lớp',
  draft: 'Bản nháp',
  ready: 'Sẵn sàng',
  published: 'Đã công bố',
  revoked: 'Đã thu hồi',
  in_progress: 'Đang làm',
  submitted: 'Đã nộp',
  graded: 'Đã chấm',
};
export function Status({ value }: { value: string }) {
  return <Badge variant="secondary">{statuses[value] ?? value}</Badge>;
}
export function InlineAction({
  intent,
  label,
  fields = {},
  disabled,
  confirm,
}: {
  intent: string;
  label: string;
  fields?: Record<string, string>;
  disabled?: boolean;
  confirm?: string;
}) {
  return (
    <Form
      method="post"
      onSubmit={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    >
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <SubmitButton size="sm" variant="outline" disabled={disabled}>
        {label}
      </SubmitButton>
    </Form>
  );
}
export function WorkspaceErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  return (
    <Page
      title={
        isRouteErrorResponse(error) && error.status === 403
          ? 'Không đủ quyền truy cập'
          : 'Không thể mở trang'
      }
    >
      <Feedback
        error={
          isRouteErrorResponse(error) && typeof error.data === 'string'
            ? error.data
            : 'Có lỗi xảy ra. Vui lòng thử lại.'
        }
      />
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => void revalidator.revalidate()}
          disabled={revalidator.state !== 'idle'}
        >
          Thử lại
        </Button>
        <Button nativeButton={false} render={<Link to="/" />}>
          Về tổng quan
        </Button>
      </div>
    </Page>
  );
}
