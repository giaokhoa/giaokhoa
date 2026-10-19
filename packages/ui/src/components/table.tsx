import { cn } from 'cn';

function Table({
  className,
  columnDividers = false,
  density = 'default',
  ...props
}: React.ComponentProps<'table'> & {
  columnDividers?: boolean;
  density?: 'default' | 'compact';
}) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn(
          'w-full caption-bottom text-sm',
          columnDividers &&
            '[&_td+td]:border-l [&_td+td]:border-border/40 [&_th+th]:border-l [&_th+th]:border-border/40 [&_[data-divider=strong]]:border-l-2 [&_[data-divider=strong]]:border-border/70',
          density === 'compact' && '[&_tbody_td]:py-1.5',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b transition-colors hover:bg-muted/50', className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn('h-10 px-2 text-left align-middle font-medium text-foreground', className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td data-slot="table-cell" className={cn('p-2 align-middle', className)} {...props} />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
