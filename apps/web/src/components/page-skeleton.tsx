import { Skeleton } from '@giaokhoa/ui/components/skeleton';

export interface PageSkeletonProps {
  rows: string[];
  className?: string;
  label?: string;
  testId?: string;
  ariaHidden?: boolean;
}

export function PageSkeleton({ rows, className = 'space-y-2', label, testId, ariaHidden }: PageSkeletonProps) {
  return (
    <div className={className} aria-label={label} data-testid={testId} aria-hidden={ariaHidden || undefined}>
      {rows.map((rowClassName, index) => (
        <Skeleton key={index} className={rowClassName} />
      ))}
    </div>
  );
}
