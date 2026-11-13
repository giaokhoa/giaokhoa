import * as React from 'react';

import { cn } from '@giaokhoa/ui/lib/utils';

export type PageWidth = 'narrow' | 'medium' | 'wide' | 'app' | 'full';

const WIDTH_CLASSES: Record<PageWidth, string> = {
  narrow: 'mx-auto w-full max-w-3xl',
  medium: 'mx-auto w-full max-w-5xl',
  wide: 'mx-auto w-full max-w-7xl',
  app: 'mx-auto w-full max-w-360 px-4 py-6 sm:px-6',
  full: 'w-full',
};

export function PageShell({
  width = 'full',
  fillHeight = false,
  className,
  contentClassName,
  children,
  ...props
}: React.ComponentProps<'main'> & {
  width?: PageWidth;
  fillHeight?: boolean;
  contentClassName?: string;
}) {
  return (
    <main
      data-slot="page-shell"
      data-width={width}
      className={cn(
        '@container/main flex flex-1 flex-col',
        width === 'app' ? 'px-0 py-0' : 'px-4 py-4 md:py-6 lg:px-6',
        fillHeight && 'min-h-0',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex flex-col gap-4 md:gap-6',
          WIDTH_CLASSES[width],
          fillHeight && 'min-h-0 flex-1',
          contentClassName,
        )}
      >
        {children}
      </div>
    </main>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn('flex flex-col gap-4 md:flex-row md:items-start md:justify-between', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
