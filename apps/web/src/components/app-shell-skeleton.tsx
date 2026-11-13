import { Skeleton } from '@giaokhoa/ui/components/skeleton';

export function AppShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full bg-sidebar" aria-hidden="true" data-testid="app-shell-skeleton">
      <div className="hidden w-72 shrink-0 p-2 md:block">
        <div className="flex h-full flex-col gap-6 px-2 py-2">
          <Skeleton className="h-9 w-32" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="mt-auto flex items-center gap-2">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
      <div className="@container/main relative flex min-w-0 flex-1 flex-col bg-background md:m-2 md:ml-0 md:rounded-xl md:shadow-sm">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
          <Skeleton className="h-5 w-44" />
        </header>
        <div className="flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          <Skeleton className="mx-4 h-8 w-72 lg:mx-6" />
          <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            <Skeleton className="h-39.5" />
            <Skeleton className="h-39.5" />
            <Skeleton className="h-39.5" />
            <Skeleton className="h-39.5" />
          </div>
          <Skeleton className="mx-4 h-97 lg:mx-6" />
        </div>
      </div>
    </div>
  );
}
