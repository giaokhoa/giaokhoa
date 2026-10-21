import { examsContract } from '@giaokhoa/shared/http/exams';
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { requestExamApi } from '#features/exams/api.server.js';
import { formatExamDate } from '#features/exams/data.js';
import { ExamErrorBoundary } from '#features/exams/error-boundary.js';
import type { Route } from './+types/index';

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);
  return { exams: await requestExamApi(request, examsContract.list) };
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const formData = await request.formData();
  const result = examsContract.create.body.safeParse({ title: formData.get('title') });
  if (!result.success) {
    return data(
      { error: 'Tiêu đề phải có từ 1 đến 200 ký tự.', invalidTitle: true },
      { status: 400 },
    );
  }

  try {
    const exam = await requestExamApi(request, examsContract.create, { body: result.data });
    return redirect(`/exams/${exam.id}`);
  } catch (error) {
    if (!(error instanceof Response)) throw error;
    return data({ error: await error.text(), invalidTitle: false }, { status: error.status });
  }
}

export default function Exams({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const isPending = navigation.state !== 'idle';
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6" aria-busy={isPending}>
      <h1 className="text-2xl font-semibold">Đề thi</h1>
      {isPending && (
        <p role="status" className="flex items-center gap-2">
          <Spinner aria-hidden="true" />
          Đang xử lý yêu cầu…
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Tạo đề thi</CardTitle>
          <CardDescription>Đặt tiêu đề, sau đó thêm câu hỏi để chốt phiên bản đề.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post">
            <FieldGroup>
              <Field data-invalid={actionData?.invalidTitle || undefined}>
                <FieldLabel htmlFor="exam-title">Tiêu đề</FieldLabel>
                <Input
                  id="exam-title"
                  name="title"
                  required
                  maxLength={200}
                  aria-invalid={actionData?.invalidTitle || undefined}
                  aria-describedby={actionData?.error ? 'create-error' : undefined}
                />
                {actionData?.error && <FieldError id="create-error">{actionData.error}</FieldError>}
              </Field>
              <Field>
                <Button type="submit" disabled={isPending}>
                  {isPending ? 'Đang xử lý…' : 'Tạo đề thi'}
                </Button>
              </Field>
            </FieldGroup>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Danh sách đề thi</CardTitle>
          <CardDescription>
            Các đề thi bạn được phép quản lý. Thời gian theo múi giờ Việt Nam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <caption className="sr-only">{loaderData.exams.length} đề thi</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Tiêu đề</TableHead>
                <TableHead>Ngày tạo</TableHead>
                <TableHead>Cập nhật</TableHead>
                <TableHead>Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loaderData.exams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>Chưa có đề thi</EmptyTitle>
                        <EmptyDescription>Hãy tạo đề đầu tiên ở trên.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {loaderData.exams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell className="max-w-sm break-words whitespace-normal">
                    {exam.title}
                  </TableCell>
                  <TableCell>
                    <time dateTime={exam.createdAt.toISOString()}>
                      {formatExamDate(exam.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <time dateTime={exam.updatedAt.toISOString()}>
                      {formatExamDate(exam.updatedAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link to={`/exams/${exam.id}`} aria-label={`Mở đề ${exam.title}`} />}
                      nativeButton={false}
                    >
                      Mở đề
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}

export const ErrorBoundary = ExamErrorBoundary;
