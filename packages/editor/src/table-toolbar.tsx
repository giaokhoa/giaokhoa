import { Button } from '@giaokhoa/ui/components/button';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@giaokhoa/ui/components/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@giaokhoa/ui/components/popover';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection, cellAround } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns3,
  Merge,
  Rows3,
  Split,
  Table2,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { ensureContinuationParagraph } from './block-continuation.js';

const TABLE_PICKER_SIZE = 8;

type PickerSize = {
  rows: number;
  cols: number;
};

function selectedTable(editor: Editor) {
  const { selection } = editor.state;

  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    return selection.node;
  }

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node.type.name === 'table') return node;
  }

  return undefined;
}

function tableHeaders(editor: Editor) {
  const table = selectedTable(editor);
  const firstRow = table?.firstChild;

  const headerRow =
    Boolean(firstRow?.childCount) &&
    Array.from({ length: firstRow?.childCount ?? 0 }, (_, index) => firstRow?.child(index)).every(
      (cell) => cell?.type.name === 'tableHeader',
    );

  const headerColumn =
    Boolean(table?.childCount) &&
    Array.from({ length: table?.childCount ?? 0 }, (_, index) => table?.child(index)).every(
      (row) => row?.firstChild?.type.name === 'tableHeader',
    );

  return { headerRow, headerColumn };
}

function useTableState(editor: Editor | null) {
  return (
    useEditorState({
      editor,
      selector: ({ editor }) => {
        if (!editor) {
          return {
            available: false,
            active: false,
            selectedCells: 0,
            canAddRowBefore: false,
            canAddRowAfter: false,
            canDeleteRow: false,
            canAddColumnBefore: false,
            canAddColumnAfter: false,
            canDeleteColumn: false,
            canMerge: false,
            canSplit: false,
            canToggleHeaderRow: false,
            canToggleHeaderColumn: false,
            canDeleteTable: false,
            headerRow: false,
            headerColumn: false,
          };
        }

        const headers = tableHeaders(editor);
        const selection = editor.state.selection;

        return {
          available: Boolean(editor.schema.nodes.table),
          active: editor.isActive('table'),
          selectedCells: selection instanceof CellSelection ? selection.ranges.length : 1,
          canAddRowBefore: editor.can().chain().addRowBefore().run(),
          canAddRowAfter: editor.can().chain().addRowAfter().run(),
          canDeleteRow: editor.can().chain().deleteRow().run(),
          canAddColumnBefore: editor.can().chain().addColumnBefore().run(),
          canAddColumnAfter: editor.can().chain().addColumnAfter().run(),
          canDeleteColumn: editor.can().chain().deleteColumn().run(),
          canMerge: editor.can().chain().mergeCells().run(),
          canSplit: editor.can().chain().splitCell().run(),
          canToggleHeaderRow: editor.can().chain().toggleHeaderRow().run(),
          canToggleHeaderColumn: editor.can().chain().toggleHeaderColumn().run(),
          canDeleteTable: editor.can().chain().deleteTable().run(),
          ...headers,
        };
      },
    }) ?? {
      available: false,
      active: false,
      selectedCells: 0,
      canAddRowBefore: false,
      canAddRowAfter: false,
      canDeleteRow: false,
      canAddColumnBefore: false,
      canAddColumnAfter: false,
      canDeleteColumn: false,
      canMerge: false,
      canSplit: false,
      canToggleHeaderRow: false,
      canToggleHeaderColumn: false,
      canDeleteTable: false,
      headerRow: false,
      headerColumn: false,
    }
  );
}

function tableCellFromTarget(editor: Editor, target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined;

  const cell = target.closest<HTMLElement>('td, th');
  if (!cell || !editor.view.dom.contains(cell)) return undefined;

  const domPos = editor.view.posAtDOM(cell, 0);
  return cellAround(editor.state.doc.resolve(domPos)) ?? undefined;
}

function tableCellFromSelection(editor: Editor) {
  const { selection } = editor.state;
  if (selection instanceof CellSelection) return selection.$headCell;
  return cellAround(selection.$head) ?? cellAround(selection.$from) ?? undefined;
}

function selectionContainsCell(selection: CellSelection, pos: number) {
  let contains = false;
  selection.forEachCell((_cell, cellPos) => {
    if (cellPos === pos) contains = true;
  });
  return contains;
}

function prepareContextCellSelection(
  editor: Editor,
  $cell: ReturnType<typeof cellAround> | undefined,
) {
  if (!$cell) return false;

  const { selection } = editor.state;
  if (selection instanceof CellSelection && selectionContainsCell(selection, $cell.pos)) {
    return true;
  }

  editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($cell)).scrollIntoView());
  return true;
}

function prepareContextSelection(editor: Editor, target: EventTarget | null) {
  return prepareContextCellSelection(editor, tableCellFromTarget(editor, target));
}

function prepareContextSelectionFromEditor(editor: Editor) {
  return prepareContextCellSelection(editor, tableCellFromSelection(editor));
}

export function TableToolbar({ editor, ownerId }: { editor: Editor | null; ownerId: string }) {
  const [open, setOpen] = useState(false);
  const [pickerSize, setPickerSize] = useState<PickerSize>({ rows: 3, cols: 3 });
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const tableState = useTableState(editor);

  if (!tableState.available) return null;

  const insertTable = ({ rows, cols }: PickerSize) => {
    if (!editor) return;
    if (editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run()) {
      ensureContinuationParagraph(editor, 'table', { moveSelection: false });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Chèn bảng"
            title="Chèn bảng"
            disabled={!editor}
          >
            <Table2 />
          </Button>
        }
      />
      <PopoverContent data-editor-owner={ownerId} align="start" className="w-64 gap-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Chèn bảng</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {pickerSize.rows} × {pickerSize.cols}
          </div>
        </div>

        <div className="grid grid-cols-8 gap-1" aria-label="Chọn kích thước bảng">
          {Array.from({ length: TABLE_PICKER_SIZE * TABLE_PICKER_SIZE }, (_, index) => {
            const row = Math.floor(index / TABLE_PICKER_SIZE) + 1;
            const col = (index % TABLE_PICKER_SIZE) + 1;
            const selected = row <= pickerSize.rows && col <= pickerSize.cols;
            const size = { rows: row, cols: col };

            return (
              <button
                key={`${row}-${col}`}
                type="button"
                aria-label={`${row} hàng, ${col} cột`}
                title={`${row} × ${col}`}
                className={`size-6 rounded-sm border transition-colors ${
                  selected ? 'border-primary bg-primary/15' : 'border-border bg-background'
                }`}
                onFocus={() => setPickerSize(size)}
                onPointerEnter={() => setPickerSize(size)}
                onClick={() => insertTable(size)}
              />
            );
          })}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withHeaderRow}
            onChange={(event) => setWithHeaderRow(event.target.checked)}
            className="size-4 accent-primary"
          />
          Hàng đầu là tiêu đề
        </label>
      </PopoverContent>
    </Popover>
  );
}

export function TableContextMenu({
  editor,
  ownerId,
  children,
}: {
  editor: Editor | null;
  ownerId: string;
  children: ReactNode;
}) {
  const tableState = useTableState(editor);
  const touchTargetRef = useRef<EventTarget | null>(null);

  if (!editor || !tableState.available) return children;

  const guardContextTarget = (target: EventTarget | null) => {
    if (prepareContextSelection(editor, target)) return true;
    return false;
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open || !touchTargetRef.current) return;
        prepareContextSelection(editor, touchTargetRef.current);
        touchTargetRef.current = null;
      }}
    >
      <ContextMenuTrigger
        style={{ userSelect: 'text' }}
        onContextMenuCapture={(event) => {
          if (guardContextTarget(event.target)) return;
          if (event.button !== 2 && prepareContextSelectionFromEditor(editor)) return;
          event.stopPropagation();
        }}
        onTouchStartCapture={(event) => {
          if (tableCellFromTarget(editor, event.target)) {
            touchTargetRef.current = event.target;
            return;
          }
          touchTargetRef.current = null;
          event.stopPropagation();
        }}
        onTouchEndCapture={() => {
          touchTargetRef.current = null;
        }}
        onTouchCancelCapture={() => {
          touchTargetRef.current = null;
        }}
      >
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent data-editor-owner={ownerId} className="w-56">
        <ContextMenuGroup>
          <ContextMenuLabel>
            {tableState.selectedCells > 1
              ? `${tableState.selectedCells} ô đã chọn`
              : 'Ô trong bảng'}
          </ContextMenuLabel>
        </ContextMenuGroup>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Rows3 />
            Hàng
          </ContextMenuSubTrigger>
          <ContextMenuSubContent data-editor-owner={ownerId} className="w-48">
            <ContextMenuItem
              disabled={!tableState.canAddRowBefore}
              onClick={() => editor.chain().focus().addRowBefore().run()}
            >
              <ArrowUp />
              Thêm hàng phía trên
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!tableState.canAddRowAfter}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <ArrowDown />
              Thêm hàng phía dưới
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!tableState.canDeleteRow}
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              <Trash2 />
              Xóa hàng
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Columns3 />
            Cột
          </ContextMenuSubTrigger>
          <ContextMenuSubContent data-editor-owner={ownerId} className="w-48">
            <ContextMenuItem
              disabled={!tableState.canAddColumnBefore}
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            >
              <ArrowLeft />
              Thêm cột bên trái
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!tableState.canAddColumnAfter}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <ArrowRight />
              Thêm cột bên phải
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!tableState.canDeleteColumn}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              <Trash2 />
              Xóa cột
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {tableState.canSplit ? (
          <ContextMenuItem onClick={() => editor.chain().focus().splitCell().run()}>
            <Split />
            Tách ô
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            disabled={!tableState.canMerge}
            onClick={() => editor.chain().focus().mergeCells().run()}
          >
            <Merge />
            Gộp ô
          </ContextMenuItem>
        )}

        <ContextMenuCheckboxItem
          checked={tableState.headerRow}
          disabled={!tableState.canToggleHeaderRow}
          onCheckedChange={() => editor.chain().focus().toggleHeaderRow().run()}
        >
          Hàng tiêu đề
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem
          checked={tableState.headerColumn}
          disabled={!tableState.canToggleHeaderColumn}
          onCheckedChange={() => editor.chain().focus().toggleHeaderColumn().run()}
        >
          Cột tiêu đề
        </ContextMenuCheckboxItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          variant="destructive"
          disabled={!tableState.canDeleteTable}
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          <Trash2 />
          Xóa bảng
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
