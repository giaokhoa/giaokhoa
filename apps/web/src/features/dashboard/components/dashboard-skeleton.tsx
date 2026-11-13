import { Skeleton } from '@giaokhoa/ui/components/skeleton';

export function DashboardSkeleton() {
  return (
    <main
      className="@container/main mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6"
      aria-hidden="true"
    >
      <Skeleton className="mx-4 h-8 w-72 lg:mx-6" />
      <Skeleton className="mx-4 h-7 w-48 lg:mx-6" />
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        <Skeleton className="h-39.5" />
        <Skeleton className="h-39.5" />
        <Skeleton className="h-39.5" />
        <Skeleton className="h-39.5" />
      </div>
      <Skeleton className="mx-4 h-97 lg:mx-6" />
      <Skeleton className="mx-4 h-75 lg:mx-6" />
    </main>
  );
}
