import { BookOpenTextIcon } from 'lucide-react';
import { Link, Outlet } from 'react-router';

export default function AuthLayout() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link
          to="/"
          className="mx-auto flex items-center gap-2 font-medium text-foreground"
          aria-label="Về trang chủ Giáo khoa"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookOpenTextIcon className="size-4" />
          </span>
          <span>Giáo khoa</span>
        </Link>
        <Outlet />
      </div>
    </main>
  );
}
