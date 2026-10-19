import { Button } from '@giaokhoa/ui/components/button';

export type TikzEditorDiagnostic = {
  severity: 'error' | 'warning';
  source?: string;
  message: string;
  line?: number;
};

type TikzEditorOverlayProps = {
  ownerId: string;
  source: string;
  previewUrl?: string;
  editing: boolean;
  loadingSource: boolean;
  rendering: boolean;
  saving: boolean;
  error?: string;
  diagnostics: TikzEditorDiagnostic[];
  canSave: boolean;
  onChange: (source: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export function TikzEditorOverlay({
  ownerId,
  source,
  previewUrl,
  editing,
  loadingSource,
  rendering,
  saving,
  error,
  diagnostics,
  canSave,
  onChange,
  onClose,
  onSave,
}: TikzEditorOverlayProps) {
  const disabled = loadingSource || saving;

  return (
    <div
      data-editor-owner={ownerId}
      className="fixed top-16 left-1/2 z-[60] max-h-[calc(100vh-5rem)] w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 overflow-y-auto rounded-2xl border bg-background p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{editing ? 'Sửa hình TikZ' : 'Hình TikZ'}</div>
          <div className="text-xs text-muted-foreground">Nhập mã TikZ để xem trước hình.</div>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            Hủy
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!canSave} onClick={onSave}>
            {saving ? 'Đang tải…' : 'Xong'}
          </Button>
        </div>
      </div>

      {loadingSource ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
          Đang tải mã TikZ…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor={`${ownerId}-tikz-source`} className="mb-2 block text-xs font-medium">
              Mã TikZ
            </label>
            <textarea
              id={`${ownerId}-tikz-source`}
              autoFocus
              spellCheck={false}
              value={source}
              disabled={disabled}
              onChange={(event) => onChange(event.currentTarget.value)}
              className="font-mono min-h-80 w-full resize-y rounded-xl border bg-transparent p-3 text-sm leading-6 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Bản xem trước</span>
              {rendering && <span className="text-xs text-muted-foreground">Đang biên dịch…</span>}
            </div>
            <div className="flex min-h-80 items-center justify-center overflow-auto rounded-xl border bg-muted/20 p-4">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Xem trước hình TikZ"
                  className="max-h-[55vh] max-w-full object-contain"
                />
              ) : (
                <span className="text-sm text-muted-foreground">
                  {rendering ? 'Đang tạo SVG…' : 'Nhập TikZ để xem trước.'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {diagnostics.length > 0 && (
        <div className="mt-3 max-h-32 overflow-auto rounded-lg border bg-muted/20 p-3 text-xs">
          {diagnostics.map((diagnostic, index) => (
            <div
              key={`${diagnostic.source ?? 'tikz'}-${diagnostic.line ?? 0}-${index}`}
              className={
                diagnostic.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'
              }
            >
              {diagnostic.line ? `Dòng ${diagnostic.line}: ` : ''}
              {diagnostic.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
