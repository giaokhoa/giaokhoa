import {
  EssayPreview,
  GuidancePreview,
  MultipleChoicePreview,
  ShortAnswerPreview,
  TrueFalsePreview,
} from '@giaokhoa/editor';
import { examsContract } from '@giaokhoa/shared/http/exams';
import type { Question } from '@giaokhoa/shared/questions';
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
import { Alert, AlertDescription } from '@giaokhoa/ui/components/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { Textarea } from '@giaokhoa/ui/components/textarea';
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
import { formatExamDate, parseRevisionInput } from '#features/exams/data.js';
import { ExamErrorBoundary } from '#features/exams/error-boundary.js';
import type { Route } from './+types/detail';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const parsedId = examsContract.get.pathParams.safeParse({ id: params.id });
  if (!parsedId.success) throw new Response('Mã đề thi phải là UUID v7.', { status: 400 });
  const id = parsedId.data.id;
  const selectedRevision = new URL(request.url).searchParams.get('revision');
  const revisionParams =
    selectedRevision === null
      ? null
      : examsContract.getRevision.pathParams.safeParse({ id, revision: selectedRevision });
  if (revisionParams && (!/^[1-9]\d*$/.test(selectedRevision!) || !revisionParams.success)) {
    throw new Response('Số phiên bản đề không hợp lệ.', { status: 400 });
  }

  const [exam, revisions] = await Promise.all([
    requestExamApi(request, examsContract.get, { id }),
    requestExamApi(request, examsContract.listRevisions, { id }),
  ]);
  revisions.sort((left, right) => right.revision - left.revision);
  const revision = revisionParams?.success ? revisionParams.data.revision : revisions[0]?.revision;
  const snapshot =
    revision === undefined
      ? null
      : await requestExamApi(request, examsContract.getRevision, { id, revision });
  return { exam, revisions, snapshot };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireSession(request);
  const parsedId = examsContract.update.pathParams.safeParse({ id: params.id });
  const fail = (error: string, status: number, field: 'title' | 'questions' | null = null) =>
    data({ error, field, success: null }, { status });
  if (!parsedId.success) return fail('Mã đề thi phải là UUID v7.', 400);
  const id = parsedId.data.id;
  const formData = await request.formData();
  const intent = formData.get('intent');

  try {
    if (intent === 'update-title') {
      const result = examsContract.update.body.safeParse({ title: formData.get('title') });
      if (!result.success) return fail('Tiêu đề phải có từ 1 đến 200 ký tự.', 400, 'title');
      await requestExamApi(request, examsContract.update, { id, body: result.data });
      return data({ error: null, field: null, success: 'Đã cập nhật tiêu đề đề thi.' });
    }
    if (intent === 'create-revision') {
      const result = parseRevisionInput(formData.get('questions'));
      if (!result.success) return fail(result.error, 400, 'questions');
      const snapshot = await requestExamApi(request, examsContract.createRevision, {
        id,
        body: result.data,
      });
      return redirect(`/exams/${id}?revision=${snapshot.revision}`);
    }
    return fail('Thao tác đề thi không hợp lệ.', 400);
  } catch (error) {
    if (!(error instanceof Response)) throw error;
    return fail(await error.text(), error.status);
  }
}

const questionTypeLabels: Record<Question['type'], string> = {
  multiple_choice: 'Trắc nghiệm',
  true_false: 'Đúng hoặc sai',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận',
};

function SnapshotQuestion({ question, position }: { question: Question; position: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Câu {position} · {questionTypeLabels[question.type]}
        </CardTitle>
        <CardDescription className="break-all">
          {question.id} · Phiên bản câu hỏi {question.version}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {question.type === 'multiple_choice' && (
            <MultipleChoicePreview content={question.content} />
          )}
          {question.type === 'true_false' && <TrueFalsePreview content={question.content} />}
          {question.type === 'short_answer' && (
            <ShortAnswerPreview content={question.content} answer={question.solution?.answer} />
          )}
          {question.type === 'essay' && <EssayPreview content={question.content} />}
          {question.guidance && <GuidancePreview content={question.guidance} />}
          <details>
            <summary className="cursor-pointer">Xem toàn bộ dữ liệu câu hỏi và đáp án</summary>
            <pre className="mt-3 max-h-96 overflow-auto text-sm break-all whitespace-pre-wrap">
              {JSON.stringify(question, null, 2)}
            </pre>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExamDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { exam, revisions, snapshot } = loaderData;
  const navigation = useNavigation();
  const isPending = navigation.state !== 'idle';
  const invalidTitle = actionData?.field === 'title';
  const invalidQuestions = actionData?.field === 'questions';
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6" aria-busy={isPending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words">{exam.title}</h1>
        <Button variant="outline" render={<Link to="/exams" />} nativeButton={false}>
          Danh sách đề thi
        </Button>
      </div>
      {isPending && (
        <p role="status" className="flex items-center gap-2">
          <Spinner aria-hidden="true" />
          Đang xử lý yêu cầu…
        </p>
      )}
      {actionData?.success && (
        <Alert role="status">
          <AlertDescription>{actionData.success}</AlertDescription>
        </Alert>
      )}
      {actionData?.error && !actionData.field && (
        <Alert variant="destructive">
          <AlertDescription>{actionData.error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin đề thi</CardTitle>
          <CardDescription>
            Đổi tiêu đề đề gốc không thay đổi các phiên bản đã chốt. Cập nhật:{' '}
            {formatExamDate(exam.updatedAt)} (giờ Việt Nam).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" key={`${exam.id}:${exam.title}`}>
            <input type="hidden" name="intent" value="update-title" />
            <FieldGroup>
              <Field data-invalid={invalidTitle || undefined}>
                <FieldLabel htmlFor="exam-title">Tiêu đề</FieldLabel>
                <Input
                  id="exam-title"
                  name="title"
                  defaultValue={exam.title}
                  required
                  maxLength={200}
                  aria-invalid={invalidTitle || undefined}
                  aria-describedby={invalidTitle ? 'title-error' : undefined}
                />
                {invalidTitle && <FieldError id="title-error">{actionData?.error}</FieldError>}
              </Field>
              <Field>
                <Button type="submit" disabled={isPending}>
                  {isPending && navigation.formData?.get('intent') === 'update-title'
                    ? 'Đang lưu…'
                    : 'Lưu tiêu đề'}
                </Button>
              </Field>
            </FieldGroup>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tạo phiên bản đề</CardTitle>
          <CardDescription>
            Chốt bản chụp bất biến từ 1 đến 100 câu hỏi sẵn sàng trong ngân hàng của bạn. Thứ tự
            dòng là thứ tự câu trong đề.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" key={`${exam.id}:${revisions.length}`}>
            <input type="hidden" name="intent" value="create-revision" />
            <FieldGroup>
              <Field data-invalid={invalidQuestions || undefined}>
                <FieldLabel htmlFor="revision-questions">Danh sách câu hỏi</FieldLabel>
                <Textarea
                  id="revision-questions"
                  name="questions"
                  rows={6}
                  required
                  spellCheck={false}
                  aria-invalid={invalidQuestions || undefined}
                  aria-describedby={
                    invalidQuestions ? 'questions-help questions-error' : 'questions-help'
                  }
                  placeholder="01900000-0000-7000-8000-000000000001,1"
                />
                <FieldDescription id="questions-help">
                  Mỗi dòng ghi questionId,version: mã UUID v7, dấu phẩy, số phiên bản nguyên dương.
                  Không lặp mã câu hỏi. Bỏ qua dòng trống.
                </FieldDescription>
                {invalidQuestions && (
                  <FieldError id="questions-error">{actionData?.error}</FieldError>
                )}
              </Field>
              <Field>
                <Button type="submit" disabled={isPending}>
                  {isPending && navigation.formData?.get('intent') === 'create-revision'
                    ? 'Đang chốt phiên bản…'
                    : 'Chốt phiên bản đề'}
                </Button>
              </Field>
            </FieldGroup>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Các phiên bản đề</CardTitle>
          <CardDescription>
            Chọn một phiên bản để xem tiêu đề và câu hỏi tại thời điểm chốt. Thời gian theo múi giờ
            Việt Nam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <caption className="sr-only">{revisions.length} phiên bản đề</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Phiên bản</TableHead>
                <TableHead>Tiêu đề đã chốt</TableHead>
                <TableHead>Ngày chốt</TableHead>
                <TableHead>Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>Chưa có phiên bản đề</EmptyTitle>
                        <EmptyDescription>Nhập danh sách câu hỏi ở trên để tạo.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {revisions.map((revision) => (
                <TableRow
                  key={revision.id}
                  data-state={snapshot?.revision === revision.revision ? 'selected' : undefined}
                >
                  <TableCell>{revision.revision}</TableCell>
                  <TableCell className="max-w-sm break-words whitespace-normal">
                    {revision.title}
                  </TableCell>
                  <TableCell>
                    <time dateTime={revision.createdAt.toISOString()}>
                      {formatExamDate(revision.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          to={`?revision=${revision.revision}`}
                          aria-label={`Xem phiên bản đề ${revision.revision}`}
                          aria-current={
                            snapshot?.revision === revision.revision ? 'page' : undefined
                          }
                        />
                      }
                    >
                      Xem bản chụp
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {snapshot && (
        <section
          className="flex min-w-0 flex-col gap-4"
          aria-label={`Bản chụp phiên bản đề ${snapshot.revision}`}
        >
          <h2 className="text-xl font-semibold break-words">
            Phiên bản {snapshot.revision}: {snapshot.title}
          </h2>
          <p className="text-sm text-muted-foreground">
            {snapshot.questions.length} câu hỏi · Chốt lúc {formatExamDate(snapshot.createdAt)} (giờ
            Việt Nam).
          </p>
          {snapshot.questions.map(({ position, question }) => (
            <SnapshotQuestion key={position} position={position} question={question} />
          ))}
        </section>
      )}
    </main>
  );
}

export const ErrorBoundary = ExamErrorBoundary;
