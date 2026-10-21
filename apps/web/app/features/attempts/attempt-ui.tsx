import { EssayPreview } from '@giaokhoa/editor';
import type { AttemptAnswer } from '@giaokhoa/shared/attempts';
import { richDocumentSchema } from '@giaokhoa/shared/questions';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { isRouteErrorResponse, Link, useRevalidator, useRouteError } from 'react-router';
import { parseQuestionContent } from './attempt-data';

export function RichDocument({ value }: { value: unknown }) {
  const parsed = richDocumentSchema.safeParse(value);
  if (!parsed.success) return <p role="alert">Nội dung không đúng định dạng tài liệu.</p>;
  return <EssayPreview content={parsed.data} />;
}

export function SavedAnswer({ answer, content }: { answer: AttemptAnswer; content?: unknown }) {
  const document = content ? parseQuestionContent(answer.type, content) : null;
  const last = document?.content?.at(-1);
  switch (answer.type) {
    case 'multiple_choice':
      if (last?.type === 'choiceList') {
        const index = last.content.findIndex((choice) => choice.attrs.id === answer.choiceId);
        const choice = last.content[index];
        if (choice)
          return (
            <div>
              <p>Phương án {String.fromCharCode(65 + index)}</p>
              <RichDocument value={{ type: 'doc', content: choice.content }} />
            </div>
          );
      }
      return (
        <p>
          Mã lựa chọn: <code>{answer.choiceId}</code>
        </p>
      );
    case 'true_false':
      return (
        <ul className="flex flex-col gap-2">
          {answer.answers.map((item) => (
            <li key={item.statementId}>
              {last?.type === 'statementList' ? (
                <RichDocument
                  value={{
                    type: 'doc',
                    content: last.content.find(
                      (statement) => statement.attrs.id === item.statementId,
                    )?.content,
                  }}
                />
              ) : (
                <code>{item.statementId}</code>
              )}
              : {item.value ? 'Đúng' : 'Sai'}
            </li>
          ))}
        </ul>
      );
    case 'short_answer':
      return <p>{answer.answer}</p>;
    case 'essay':
      return 'answer' in answer ? (
        <RichDocument value={answer.answer} />
      ) : (
        <div className="flex flex-col gap-4">
          {answer.answers.map((part) => (
            <section key={part.partId}>
              <h3>
                Mã phần: <code>{part.partId}</code>
              </h3>
              <RichDocument value={part.content} />
            </section>
          ))}
        </div>
      );
  }
}

export function AttemptMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function RefreshAttempt() {
  const revalidator = useRevalidator();
  return (
    <Button
      variant="outline"
      disabled={revalidator.state !== 'idle'}
      onClick={() => void revalidator.revalidate()}
    >
      {revalidator.state === 'idle' ? 'Tải lại dữ liệu' : 'Đang tải…'}
    </Button>
  );
}

export function AttemptErrorBoundary() {
  const error = useRouteError();
  const message =
    isRouteErrorResponse(error) && typeof error.data === 'string'
      ? error.data
      : 'Không thể tải trang. Vui lòng thử lại.';
  return (
    <main className="flex flex-col gap-4 p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Không thể mở lượt làm bài</CardTitle>
          <CardDescription>
            {isRouteErrorResponse(error) ? `Mã lỗi: ${error.status}` : 'Đã xảy ra lỗi'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p role="alert">{message}</p>
            <RefreshAttempt />
            <Link to="/login">Đăng nhập lại</Link>
            <Link to="/">Về trang chủ</Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export function AttemptLoading() {
  return (
    <main aria-label="Đang tải lượt làm bài" className="flex flex-col gap-4 p-4 lg:p-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-48 w-full" />
    </main>
  );
}
