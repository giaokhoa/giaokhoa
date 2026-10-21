import { Button } from '@giaokhoa/ui/components/button';
import { Alert, AlertDescription, AlertTitle } from '@giaokhoa/ui/components/alert';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

export function ExamErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="flex flex-col gap-4 p-4 lg:p-6">
      <Alert variant="destructive">
        <AlertTitle>Không thể mở đề thi</AlertTitle>
        <AlertDescription>
          {isRouteErrorResponse(error) && typeof error.data === 'string'
            ? error.data
            : 'Đã xảy ra lỗi. Vui lòng thử lại.'}
        </AlertDescription>
      </Alert>
      <Button render={<Link to="/exams" />} nativeButton={false} variant="outline">
        Về danh sách đề thi
      </Button>
    </main>
  );
}
