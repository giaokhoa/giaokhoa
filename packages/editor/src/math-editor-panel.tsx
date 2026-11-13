import { useMemo } from 'react';
import { renderMathHtml } from './math.js';

/**
 * Panel soạn một công thức LaTeX dạng overlay nổi, dùng chung cho cả
 * hai loại node công thức (`inlineMath` trong dòng, `blockMath` tách
 * dòng) của trình soạn rich text.
 *
 * Flow tổng thể của file này (đầu vào là mã LaTeX + loại công thức
 * hiện tại qua props, đầu ra là các callback về phía chứa):
 *
 * 1. Người soạn nhập mã LaTeX trong ô nhập, gạt nút tách dòng để đổi
 *    loại công thức; vùng xem trước render trực tiếp bằng KaTeX theo
 *    từng thay đổi (mã rỗng thì không xem trước).
 * 2. Enter trong ô nhập là xác nhận, Escape là huỷ; nút xác nhận gọi
 *    `onConfirm` (phía chứa kiểm tra cú pháp bằng `validateMathLatex`
 *    trước khi áp vào tài liệu), nút huỷ gọi `onCancel` để đóng panel
 *    mà không đổi tài liệu, nút xoá (`onDelete`, chỉ khi đang sửa một
 *    công thức có sẵn) gỡ công thức khỏi tài liệu.
 * 3. Panel mang `data-editor-owner` theo editor đang mở nó để cơ chế
 *    một-toolbar của {@link RichTextEditor} biết tương tác trong panel
 *    vẫn thuộc về editor đó (không tắt trạng thái active của editor).
 *
 * Bất biến: panel chỉ trình bày — việc kiểm tra cú pháp và áp mã vào
 * tài liệu nằm ở phía chứa; LaTeX là nguồn sự thật, bản render KaTeX
 * chỉ là phái sinh.
 */

/** Loại node công thức mà panel đang soạn: trong dòng hoặc tách dòng. */
export type MathNodeKind = 'inlineMath' | 'blockMath';

/**
 * Thuộc tính của {@link MathEditorPanel}.
 */
export interface MathEditorPanelProps {
  /** Mã LaTeX hiện tại trong ô nhập. */
  latex: string;
  /** Loại công thức đang soạn (trong dòng / tách dòng). */
  kind: MathNodeKind;
  /** Thông báo lỗi cú pháp sau lần xác nhận bị chặn; không có thì panel đang sạch. */
  error?: string;
  /**
   * Mã định danh chủ sở hữu của editor đang mở panel; khi truyền, panel
   * mang thuộc tính `data-editor-owner` để cơ chế một-toolbar của
   * {@link RichTextEditor} biết tương tác trong panel vẫn thuộc về
   * editor đó (không tắt trạng thái active của editor).
   */
  ownerId?: string;
  /** Được gọi mỗi khi mã LaTeX thay đổi. */
  onLatexChange: (latex: string) => void;
  /** Được gọi khi người soạn đổi loại công thức. */
  onKindChange: (kind: MathNodeKind) => void;
  /** Xác nhận: phía chứa kiểm tra cú pháp trước khi áp vào tài liệu. */
  onConfirm: () => void;
  /** Huỷ bỏ, đóng panel mà không đổi tài liệu. */
  onCancel: () => void;
  /** Xoá công thức đang sửa; chỉ truyền khi panel đang sửa một công thức có sẵn. */
  onDelete?: () => void;
}

/**
 * Panel soạn một công thức LaTeX: ô nhập mã, nút gạt tách dòng, và vùng
 * xem trước render trực tiếp bằng KaTeX theo từng thay đổi. Enter trong ô
 * nhập là xác nhận, Escape là huỷ. Việc kiểm tra cú pháp và áp vào tài
 * liệu nằm ở phía chứa ({@link RichTextEditor}) — panel chỉ trình bày.
 *
 * Trình bày: overlay nổi ở đầu trang (class `giaokhoa-math-panel` trong
 * `editor.css`: fixed, shadow lớn) theo đúng mẫu overlay công thức của
 * editor giaokhoa — trước lát E1 panel là một khối inline không style
 * đẩy toàn bộ nội dung form xuống mỗi lần mở.
 *
 * @param props - Thuộc tính của panel.
 * @returns Phần tử panel soạn công thức.
 */
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
