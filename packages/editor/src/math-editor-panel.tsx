import { useMemo } from 'react';
import { renderMathHtml } from './math.js';

export type MathNodeKind = 'inlineMath' | 'blockMath';

export interface MathEditorPanelProps {
  latex: string;
  kind: MathNodeKind;
  error?: string;
  ownerId?: string;
  onLatexChange: (latex: string) => void;
  onKindChange: (kind: MathNodeKind) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function MathEditorPanel({
  latex,
  kind,
  error,
  ownerId,
  onLatexChange,
  onKindChange,
  onConfirm,
  onCancel,
  onDelete,
}: MathEditorPanelProps) {
  const previewHtml = useMemo(
    () => (latex.trim() ? renderMathHtml(latex, kind === 'blockMath') : ''),
    [latex, kind],
  );

  return (
    <section
      className="giaokhoa-math-panel"
      aria-label="Soạn công thức LaTeX"
      data-testid="math-panel"
      data-editor-owner={ownerId}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Công thức LaTeX</div>
          <div className="text-xs text-muted-foreground">Nhập LaTeX, ví dụ: x^2 + y^2 = z^2</div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-sm font-medium hover:bg-muted"
          onClick={onConfirm}
        >
          Xong
        </button>
      </div>
      <button
        type="button"
        aria-pressed={kind === 'blockMath'}
        className="mb-3 inline-flex h-8 items-center rounded-md border border-input bg-transparent px-2.5 text-sm font-medium shadow-xs hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
        onClick={() => onKindChange(kind === 'blockMath' ? 'inlineMath' : 'blockMath')}
      >
        Tách dòng
      </button>
      <input
        autoFocus
        aria-label="Mã LaTeX"
        aria-invalid={error ? true : undefined}
        value={latex}
        onChange={(event) => onLatexChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onCancel();
          }
          if (event.key === 'Enter') {
            onConfirm();
          }
        }}
        className="h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {previewHtml ? (
        <div
          className="mt-4 overflow-x-auto rounded-xl border bg-muted/30 p-4"
          aria-label="Xem trước công thức"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium hover:bg-muted"
          onClick={onCancel}
        >
          Huỷ
        </button>
        {onDelete ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-destructive hover:bg-destructive/10"
            onClick={onDelete}
          >
            Xoá công thức
          </button>
        ) : null}
      </div>
    </section>
  );
}
