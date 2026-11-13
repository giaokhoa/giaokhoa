import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@giaokhoa/ui/components/button';


function pageNumberList(pageCount: number, current: number): (number | 'ellipsis')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
  const kept = [...new Set([0, pageCount - 1, current - 1, current, current + 1])]
    .filter((page) => page >= 0 && page < pageCount)
    .sort((a, b) => a - b);
  const list: (number | 'ellipsis')[] = [];
  kept.forEach((page, index) => {
    if (index > 0 && page - kept[index - 1]! > 1) list.push('ellipsis');
    list.push(page);
  });
  return list;
}

export interface TablePaginationProps {
  page: number;
  pageCount: number;
  summary: string;
  previousLabel: string;
  nextLabel: string;
  onPageChange: (page: number) => void;
}

export function TablePagination({
  page,
  pageCount,
  summary,
  previousLabel,
  nextLabel,
  onPageChange,
}: TablePaginationProps) {
  const current = page - 1;
  const pages = pageNumberList(Math.max(pageCount, 1), current);
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4 max-sm:flex-col md:max-lg:flex-col">
      <p className="text-sm whitespace-nowrap text-muted-foreground">{summary}</p>
      <nav aria-label="pagination" className="mx-0 w-auto">
        <ul className="flex flex-row items-center gap-1">
          <li>
            <Button
              type="button"
              variant="ghost"
              className="h-9 gap-1.5 px-2.5"
              disabled={current <= 0}
              onClick={() => onPageChange(current)}
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:block">{previousLabel}</span>
            </Button>
          </li>
          {pages.map((item, index) =>
            item === 'ellipsis' ? (
              <li key={`ellipsis-${index}`} className="grid size-9 place-items-center">
                <MoreHorizontal aria-hidden className="size-4 text-muted-foreground" />
              </li>
            ) : (
              <li key={item}>
                <Button
                  type="button"
                  variant={item === current ? 'default' : 'ghost'}
                  size="icon"
                  className="size-9"
                  aria-current={item === current ? 'page' : undefined}
                  onClick={() => onPageChange(item + 1)}
                >
                  {item + 1}
                </Button>
              </li>
            ),
          )}
          <li>
            <Button
              type="button"
              variant="ghost"
              className="h-9 gap-1.5 px-2.5"
              disabled={current >= pageCount - 1}
              onClick={() => onPageChange(current + 2)}
            >
              <span className="hidden sm:block">{nextLabel}</span>
              <ChevronRight className="size-4" />
            </Button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
