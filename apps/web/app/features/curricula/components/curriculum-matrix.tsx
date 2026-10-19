import type { Subject } from '@giaokhoa/shared/curriculum';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { CheckIcon, MinusIcon } from 'lucide-react';

export type CurriculumMatrixRow = Subject & { grades: number[] };

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, CurriculumMatrixRow>();

const gradeGroups = [
  { id: 'primary', label: 'Tiểu học', grades: [1, 2, 3, 4, 5] },
  { id: 'lower-secondary', label: 'THCS', grades: [6, 7, 8, 9] },
  { id: 'upper-secondary', label: 'THPT', grades: [10, 11, 12] },
] as const;

const groupColumnIds = new Set<string>(gradeGroups.map((group) => group.id));
const groupStartColumnIds = new Set<string>(gradeGroups.map((group) => 'grade-' + group.grades[0]));

function columnBorderClass(columnId: string) {
  if (columnId === 'position') return undefined;
  if (columnId === 'name' || groupColumnIds.has(columnId) || groupStartColumnIds.has(columnId)) {
    return 'border-l-2 border-border/70';
  }
  return 'border-l border-border/40';
}

function gradeColumn(grade: number) {
  return columnHelper.display({
    id: 'grade-' + grade,
    header: () => <div className="min-w-9 text-center">L{grade}</div>,
    cell: ({ row }) => {
      const hasCurriculum = row.original.grades.includes(grade);

      return (
        <div className="flex min-w-9 justify-center">
          {hasCurriculum ? (
            <>
              <CheckIcon className="size-4" aria-hidden />
              <span className="sr-only">Có chương trình lớp {grade}</span>
            </>
          ) : (
            <>
              <MinusIcon className="size-4 text-muted-foreground/40" aria-hidden />
              <span className="sr-only">Không có chương trình lớp {grade}</span>
            </>
          )}
        </div>
      );
    },
  });
}

function gradeGroup(id: string, label: string, grades: readonly number[]) {
  return columnHelper.group({
    id,
    header: () => <div className="text-center">{label}</div>,
    columns: columnHelper.columns(grades.map((grade) => gradeColumn(grade))),
  });
}

const columns = columnHelper.columns([
  columnHelper.accessor('position', {
    header: () => <div className="px-1 text-center">STT</div>,
    cell: ({ row }) => <div className="px-1 text-center tabular-nums">{row.original.position}</div>,
  }),
  columnHelper.accessor('name', {
    header: 'Môn học',
    cell: ({ row }) => <span className="font-medium whitespace-nowrap">{row.original.name}</span>,
  }),
  ...gradeGroups.map((group) => gradeGroup(group.id, group.label, group.grades)),
]);

export function CurriculumMatrix({ rows }: { rows: CurriculumMatrixRow[] }) {
  const table = useTable({ features, columns, data: rows });

  return (
    <div className="w-full overflow-hidden rounded-lg border">
      <Table className="min-w-[920px]">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  className={columnBorderClass(header.column.id)}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={columnBorderClass(cell.column.id)}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={table.getAllLeafColumns().length} className="h-24 text-center">
                Chưa có chương trình học.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
