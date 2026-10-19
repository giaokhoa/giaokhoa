import type { Subject } from '@giaokhoa/shared/curriculum';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { SubjectEditSheet } from './subject-edit-sheet';

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, Subject>();

const strongDividerColumnIds = new Set(['name', 'slug', 'actions']);

function strongDivider(columnId: string) {
  return strongDividerColumnIds.has(columnId) ? 'strong' : undefined;
}

function SubjectActions({ subject }: { subject: Subject }) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex justify-center px-1">
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => setEditing(true)}>
          <PencilIcon />
          <span className="sr-only">Sửa {subject.name}</span>
        </Button>
      </div>
      {editing && <SubjectEditSheet subject={subject} onClose={() => setEditing(false)} />}
    </>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor('position', {
    header: () => <div className="px-1 text-center">STT</div>,
    cell: ({ row }) => <div className="px-1 text-center tabular-nums">{row.original.position}</div>,
  }),
  columnHelper.accessor('name', {
    header: 'Tên môn học',
  }),
  columnHelper.accessor('slug', {
    header: 'Slug',
    cell: ({ row }) => <span className="lowercase italic">{row.original.slug}</span>,
  }),
  columnHelper.display({
    id: 'actions',
    header: () => (
      <div className="px-1 text-center">
        <span className="sr-only">Thao tác</span>
      </div>
    ),
    cell: ({ row }) => <SubjectActions subject={row.original} />,
  }),
]);

export function SubjectsTable({ subjects }: { subjects: Subject[] }) {
  const table = useTable({ features, columns, data: subjects });

  return (
    <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-lg border">
      <Table columnDividers density="compact">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  data-divider={
                    header.column.id === 'name' || header.column.id === 'slug'
                      ? 'strong'
                      : undefined
                  }
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
                  <TableCell key={cell.id} data-divider={strongDivider(cell.column.id)}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                Chưa có môn học.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
