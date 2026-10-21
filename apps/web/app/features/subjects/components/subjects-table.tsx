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
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { SubjectFormSheet } from './subject-edit-sheet';

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, Subject>();

const strongDividerColumnIds = new Set(['name', 'slug', 'actions']);

function strongDivider(columnId: string) {
  return strongDividerColumnIds.has(columnId) ? 'strong' : undefined;
}

function SubjectActions({ subject }: { subject: Subject }) {
  const [editing, setEditing] = useState(false);
  const fetcher = useFetcher<{ error?: string; deleted?: boolean }>();

  return (
    <>
      <div className="flex items-center justify-center gap-1 px-1">
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => setEditing(true)}>
          <PencilIcon />
          <span className="sr-only">Sửa {subject.name}</span>
        </Button>
        <fetcher.Form
          method="post"
          onSubmit={(event) => {
            if (!window.confirm('Bạn chắc chắn muốn xóa môn ' + subject.name + '?'))
              event.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="id" value={subject.id} />
          <Button
            type="submit"
            variant="destructive"
            size="icon-xs"
            disabled={fetcher.state !== 'idle'}
          >
            <Trash2Icon />
            <span className="sr-only">Xóa {subject.name}</span>
          </Button>
        </fetcher.Form>
      </div>
      {fetcher.data?.error && (
        <p role="alert" className="text-sm text-destructive">
          {fetcher.data.error}
        </p>
      )}
      {editing && <SubjectFormSheet subject={subject} onClose={() => setEditing(false)} />}
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
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          Thêm môn học
        </Button>
      </div>
      {creating && <SubjectFormSheet onClose={() => setCreating(false)} />}
      <div className="overflow-hidden rounded-lg border">
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
    </div>
  );
}
