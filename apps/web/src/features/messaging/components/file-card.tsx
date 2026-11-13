import { FileText } from 'lucide-react';
import { Card } from '@giaokhoa/ui/components/card';
import { cn } from '@giaokhoa/ui/lib/utils';

export function FileCard({
  name,
  sizeLabel,
  own = false,
  href,
}: {
  name: string;
  sizeLabel?: string;
  own?: boolean;
  href?: string;
}) {
  const card = (
    <Card
      className={cn(
        'flex-row items-center gap-2 rounded-lg border px-3 py-2 shadow-none ring-0 transition-colors',
        own
          ? 'border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/15'
          : 'border-border bg-background hover:bg-background/80',
      )}
    >
      <FileText className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{name}</p>
        {sizeLabel ? <p className="text-[10px] opacity-70">{sizeLabel}</p> : null}
      </div>
    </Card>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" download={name} className="block">
      {card}
    </a>
  ) : (
    card
  );
}
