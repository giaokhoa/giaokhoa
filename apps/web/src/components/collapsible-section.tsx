import type { ReactNode } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from '@giaokhoa/ui/components/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@giaokhoa/ui/components/collapsible';
import { cn } from '@giaokhoa/ui/lib/utils';

export function CollapsibleSection({
  title,
  description,
  open,
  onOpenChange,
  id,
  className,
  contentClassName,
  paddedContent = true,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id?: string;
  className?: string;
  contentClassName?: string;
  paddedContent?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card id={id} className={className}>
        <CardHeader>
          <CollapsibleTrigger className="group/collapse-trigger flex w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span className="flex min-w-0 flex-col gap-1">
              <CardTitle>{title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </span>
            <IconChevronDown
              aria-hidden
              className={cn(
                'size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/collapse-trigger:text-foreground',
                open && 'rotate-180',
              )}
            />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          {paddedContent ? (
            <CardContent className={contentClassName ?? 'space-y-4'}>{children}</CardContent>
          ) : (
            children
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
