import { isRouteErrorResponse, useRevalidator } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';

export function RouteErrorBoundary({ error }: { error: unknown }) {
  const revalidator = useRevalidator();
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : 'Đã xảy ra lỗi không mong muốn.';
  return (
    <main className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <h1 className="text-xl font-semibold">Không tải được trang này</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="flex items-center gap-4">
        <Button type="button" onClick={() => revalidator.revalidate()}>
          Thử lại
        </Button>
        <a href="/" className="text-sm underline underline-offset-4">
          Về trang chủ
        </a>
      </div>
    </main>
  );
}
