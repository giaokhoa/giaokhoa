import * as React from 'react';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconLayoutColumns,
} from '@tabler/icons-react';
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  FlexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';

import { Button } from '@giaokhoa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import { Input } from '@giaokhoa/ui/components/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@giaokhoa/ui/components/table';

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

function createLatestColumnsStore<T>(initial: T) {
  let current = initial;
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    getVersion: () => version,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update: (next: T) => {
      if (current === next) return;
      current = next;
      version += 1;
      for (const listener of listeners) listener();
    },
  };
}

export interface DataColumn<T extends object> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  filterValue?: (row: T) => string;
}

export interface DataTableLabels {
  columns: string;
  previous: string;
  next: string;
  empty: string;
  pageInfo: (page: number, pages: number) => string;
  filterPlaceholder?: string;
  rangeInfo?: (from: number, to: number, total: number) => string;
}

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

export function DataTable<T extends object>({
  title,
  data,
  columns,
  labels,
  getRowId,
  pageSize = 10,
  manualPagination = false,
  pageCount,
  pagination: paginationProp,
  onPaginationChange,
  manualSorting = false,
  sorting: sortingProp,
  onSortingChange,
  rowTestId,
  totalRows,
}: {
  title?: string;
  data: T[];
  columns: DataColumn<T>[];
  labels: DataTableLabels;
  getRowId: (row: T) => string;
  pageSize?: number;
  totalRows?: number;
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  rowTestId?: (row: T) => string;
}) {
  type AnyRow = Record<string, unknown>;
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const sorting = sortingProp ?? internalSorting;
  const handleSortingChange: OnChangeFn<SortingState> = onSortingChange ?? setInternalSorting;
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const pagination = paginationProp ?? internalPagination;
  const handlePaginationChange: OnChangeFn<PaginationState> = onPaginationChange ?? setInternalPagination;

  const [columnsStore] = React.useState(() => createLatestColumnsStore(columns));
  React.useSyncExternalStore(columnsStore.subscribe, columnsStore.getVersion, columnsStore.getVersion);
  React.useLayoutEffect(() => { columnsStore.update(columns); }, [columnsStore, columns]);
  const columnSignature = JSON.stringify(
    columns.map((col) => [col.id, col.header, Boolean(col.sortValue)]),
  );
  const tableColumns = React.useMemo(() => {
    const helper = createColumnHelper<typeof features, AnyRow>();
    const shapes = JSON.parse(columnSignature) as [id: string, header: string, sortable: boolean][];
    return helper.columns(
      shapes.map(([id, header, sortable]) =>
        helper.accessor(
          (row: AnyRow): string | number => {
            const latest = columnsStore.get().find((c) => c.id === id);
            return latest?.filterValue
              ? latest.filterValue(row as T)
              : latest?.sortValue
                ? latest.sortValue(row as T)
                : '';
          },
          {
            id,
            header,
            enableSorting: sortable,
            cell: (info) => {
              const latest = columnsStore.get().find((c) => c.id === id);
              return latest ? latest.cell(info.row.original as T) : null;
            },
          },
        ),
      ),
    );
  }, [columnSignature, columnsStore]);

  const table = useTable({
    features,
    data: data as AnyRow[],
    columns: tableColumns,
    state: { columnVisibility, rowSelection, columnFilters, globalFilter, sorting, pagination },
    getRowId: (row) => getRowId(row as T),
    enableRowSelection: true,
    manualPagination,
    manualSorting,
    pageCount,
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
  });

  const currentPageIndex = table.state.pagination.pageIndex;
  const totalForRange = totalRows ?? table.getFilteredRowModel().rows.length;
  const rangeFrom = totalForRange === 0 ? 0 : currentPageIndex * table.state.pagination.pageSize + 1;
  const rangeTo = currentPageIndex * table.state.pagination.pageSize + table.getRowModel().rows.length;

  return (
    <div className="flex w-full flex-col gap-4 px-4 lg:px-6">
      {title ? <h3 className="text-base font-semibold">{title}</h3> : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {labels.filterPlaceholder ? (
            <Input
              aria-label={labels.filterPlaceholder}
              placeholder={labels.filterPlaceholder}
              value={globalFilter}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              className="max-w-sm"
            />
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <IconLayoutColumns />
            <span className="hidden lg:inline">{labels.columns}</span>
            <IconChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {columns.find((c) => c.id === column.id)?.header ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, headerIndex) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={headerIndex === 0 ? 'sticky left-0 z-20 bg-muted' : undefined}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-8"
                        onClick={() => header.column.toggleSorting(header.column.getIsSorted() === 'asc')}
                      >
                        <FlexRender header={header} />
                      </Button>
                    ) : (
                      <FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-testid={rowTestId?.(row.original as T)}>
                  {row.getVisibleCells().map((cell, cellIndex) => (
                    <TableCell key={cell.id} className={cellIndex === 0 ? 'sticky left-0 z-10 bg-background' : undefined}>
                      <FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {labels.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {labels.rangeInfo
            ? labels.rangeInfo(rangeFrom, rangeTo, totalForRange)
            : labels.pageInfo(table.state.pagination.pageIndex + 1, Math.max(table.getPageCount(), 1))}
        </div>
        {labels.rangeInfo || table.getPageCount() > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">{labels.previous}</span>
              <IconChevronsLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">{labels.previous}</span>
              <IconChevronLeft />
            </Button>
            {labels.rangeInfo
              ? pageNumberList(Math.max(table.getPageCount(), 1), currentPageIndex).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span key={`ellipsis-${index}`} className="px-1 text-sm text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === currentPageIndex ? 'default' : 'outline'}
                      className="size-8"
                      size="icon"
                      aria-current={item === currentPageIndex ? 'page' : undefined}
                      onClick={() => table.setPageIndex(item)}
                    >
                      {item + 1}
                    </Button>
                  ),
                )
              : null}
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">{labels.next}</span>
              <IconChevronRight />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">{labels.next}</span>
              <IconChevronsRight />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
