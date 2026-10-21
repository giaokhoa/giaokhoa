import type { TikzFileSource } from '@giaokhoa/shared/files';
import { IMAGE_NODE_MAX_DIMENSION } from '@giaokhoa/shared/questions';
import { Button } from '@giaokhoa/ui/components/button';
import { Field, FieldTitle } from '@giaokhoa/ui/components/field';
import { Toggle } from '@giaokhoa/ui/components/toggle';
import type { Editor, Extensions, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import type { EditorProps } from '@tiptap/pm/view';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { renderToString } from 'katex';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ImagePlus,
  Redo2,
  Shapes,
  Sigma,
  Undo2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  cropImageFile,
  FULL_IMAGE_CROP,
  imageNameStem,
  ImageEditorOverlay,
  type ImageCrop,
} from './image-editor.js';
import {
  contentForSave,
  ensureContinuationParagraph,
  ensureTerminalContinuations,
} from './block-continuation.js';
import { TableContextMenu, TableToolbar } from './table-toolbar.js';
import { TikzEditorOverlay } from './tikz-editor.js';

export type UploadedImage = {
  fileId: string;
  variantFileId: string | null;
  src: string;
  width: number;
  height: number;
};

export type UploadImage = (
  file: File,
  fileId?: string,
  source?: TikzFileSource,
) => Promise<UploadedImage>;

export type LoadOriginalImage = (fileId: string) => Promise<{ blob: Blob; src: string }>;
export type LoadTikzSource = (fileId: string) => Promise<string>;

export type TikzDiagnostic = {
  severity: 'error' | 'warning';
  source?: string;
  message: string;
  line?: number;
};

export type RenderTikzResult = {
  svg: string;
  diagnostics: TikzDiagnostic[];
};

export type RenderTikz = (source: string) => Promise<RenderTikzResult>;

type StoredImageCrop = Pick<ImageCrop, 'x' | 'y' | 'width' | 'height'>;

function storedImageCrop(crop: ImageCrop): StoredImageCrop | null {
  if (
    crop.unit === '%' &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === 100 &&
    crop.height === 100
  ) {
    return null;
  }
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function editorImageCrop(crop: StoredImageCrop | null | undefined): ImageCrop {
  return crop ? { unit: '%', ...crop } : { ...FULL_IMAGE_CROP };
}

function sameStoredImageCrop(left: StoredImageCrop | null, right: StoredImageCrop | null) {
  if (!left || !right) return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function storedImageCropFrom(value: unknown): StoredImageCrop | null {
  if (!value || typeof value !== 'object') return null;
  const crop = value as Record<string, unknown>;
  if (
    typeof crop.x !== 'number' ||
    typeof crop.y !== 'number' ||
    typeof crop.width !== 'number' ||
    typeof crop.height !== 'number'
  ) {
    return null;
  }
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function imageDisplaySize(
  renderedWidth: number,
  renderedHeight: number,
  preferredWidth: number,
  editorMaxWidth: number,
) {
  const width = Math.min(
    preferredWidth,
    editorMaxWidth,
    IMAGE_NODE_MAX_DIMENSION,
    (IMAGE_NODE_MAX_DIMENSION * renderedWidth) / renderedHeight,
  );

  return {
    width,
    height: Math.min(IMAGE_NODE_MAX_DIMENSION, (width * renderedHeight) / renderedWidth),
  };
}

type MathNodeType = 'inlineMath' | 'blockMath';

type MathEditorState = {
  pos: number;
  type: MathNodeType;
  originalType?: MathNodeType;
  latex: string;
  error?: string;
};

type ExistingImageState = {
  fileId: string;
  variantFileId: string | null;
  fileNameStem: string;
  crop: StoredImageCrop | null;
};

type ImageEditorState = {
  pos: number;
  maxWidth: number;
  existing?: ExistingImageState;
  sourceAsset?: { fileId: string; src: string };
  loading?: boolean;
  file?: File;
  fileNameStem?: string;
  previewUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  crop?: ImageCrop;
  uploading: boolean;
  error?: string;
};

type TikzEditorState = {
  pos: number;
  maxWidth: number;
  source: string;
  initialSource?: string;
  existingAssetId?: string;
  loadingSource?: boolean;
  rendering?: boolean;
  saving?: boolean;
  rendered?: RenderTikzResult & { source: string };
  previewUrl?: string;
  error?: string;
};

type SimpleEditorProps = {
  content: JSONContent;
  extensions: Extensions;
  onUpdate?: (content: JSONContent) => void;
  onReady?: () => void;
  uploadImage?: UploadImage;
  loadOriginalImage?: LoadOriginalImage;
  loadTikzSource?: LoadTikzSource;
  renderTikz?: RenderTikz;
  toolbar?: boolean;
  editorClassName?: string;
  frameClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

type EditorFieldProps = Omit<SimpleEditorProps, 'ariaLabel' | 'ariaLabelledBy'> & {
  label?: string;
  description?: string;
};

function HistoryToolbar({
  editor,
  ownerId,
  onInsertMath,
  onInsertImage,
  onInsertTikz,
}: {
  editor: Editor | null;
  ownerId: string;
  onInsertMath: () => void;
  onInsertImage?: () => void;
  onInsertTikz?: () => void;
}) {
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor }) => {
      const imageSelected = editor?.isActive('image') ?? false;
      const paragraphSelected = editor?.isActive('paragraph') ?? false;
      const imageAlign = imageSelected ? editor?.getAttributes('image').align : undefined;
      const textAlign = paragraphSelected
        ? editor?.getAttributes('paragraph').textAlign
        : undefined;

      return {
        canUndo: editor?.can().chain().undo().run() ?? false,
        canRedo: editor?.can().chain().redo().run() ?? false,
        alignmentTarget: imageSelected ? 'image' : paragraphSelected ? 'text' : undefined,
        alignment: imageSelected
          ? imageAlign === 'left' || imageAlign === 'right'
            ? imageAlign
            : 'center'
          : textAlign === 'center' || textAlign === 'right' || textAlign === 'justify'
            ? textAlign
            : 'left',
      };
    },
  }) ?? {
    canUndo: false,
    canRedo: false,
    alignmentTarget: undefined,
    alignment: 'left',
  };

  const setAlignment = (align: 'left' | 'center' | 'right' | 'justify') => {
    if (!editor) return;

    if (toolbarState.alignmentTarget === 'image') {
      if (align !== 'justify') {
        editor.chain().focus().updateAttributes('image', { align }).run();
      }
      return;
    }

    if (toolbarState.alignmentTarget === 'text') {
      editor.chain().focus().setTextAlign(align).run();
    }
  };

  const headerTarget =
    typeof document === 'undefined' ? null : document.getElementById('editor-toolbar-slot');

  const toolbar = (
    <div
      data-editor-owner={ownerId}
      className={
        headerTarget
          ? 'pointer-events-auto flex h-full min-w-0 items-center overflow-x-auto bg-background'
          : 'sticky top-0 z-20 mb-2 overflow-x-auto rounded-lg border bg-background shadow-sm'
      }
    >
      <div
        className="flex h-11 min-w-max items-center gap-1 px-2"
        role="toolbar"
        aria-label="Công cụ chỉnh sửa"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Hoàn tác"
          title="Hoàn tác"
          disabled={!toolbarState.canUndo}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Làm lại"
          title="Làm lại"
          disabled={!toolbarState.canRedo}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Chèn công thức"
          title="Chèn công thức"
          disabled={!editor}
          onClick={onInsertMath}
        >
          <Sigma />
        </Button>
        {onInsertImage && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Chèn ảnh"
            title="Chèn ảnh"
            disabled={!editor}
            onClick={onInsertImage}
          >
            <ImagePlus />
          </Button>
        )}
        {onInsertTikz && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Chèn hình TikZ"
            title="Chèn hình TikZ"
            disabled={!editor}
            onClick={onInsertTikz}
          >
            <Shapes />
          </Button>
        )}
        <TableToolbar editor={editor} ownerId={ownerId} />
        {toolbarState.alignmentTarget && (
          <>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Toggle
              type="button"
              size="sm"
              variant="outline"
              className="size-8 p-0"
              pressed={toolbarState.alignment === 'left'}
              aria-label="Căn trái"
              title="Căn trái"
              onPressedChange={(pressed) => {
                if (pressed) setAlignment('left');
              }}
            >
              <AlignLeft />
            </Toggle>
            <Toggle
              type="button"
              size="sm"
              variant="outline"
              className="size-8 p-0"
              pressed={toolbarState.alignment === 'center'}
              aria-label="Căn giữa"
              title="Căn giữa"
              onPressedChange={(pressed) => {
                if (pressed) setAlignment('center');
              }}
            >
              <AlignCenter />
            </Toggle>
            <Toggle
              type="button"
              size="sm"
              variant="outline"
              className="size-8 p-0"
              pressed={toolbarState.alignment === 'right'}
              aria-label="Căn phải"
              title="Căn phải"
              onPressedChange={(pressed) => {
                if (pressed) setAlignment('right');
              }}
            >
              <AlignRight />
            </Toggle>
            {toolbarState.alignmentTarget === 'text' && (
              <Toggle
                type="button"
                size="sm"
                variant="outline"
                pressed={toolbarState.alignment === 'justify'}
                aria-label="Căn đều"
                title="Căn đều"
                onPressedChange={(pressed) => {
                  if (pressed) setAlignment('justify');
                }}
              >
                <AlignJustify />
              </Toggle>
            )}
          </>
        )}
      </div>
    </div>
  );

  return headerTarget ? createPortal(toolbar, headerTarget) : toolbar;
}

function MathEditorOverlay({
  ownerId,
  state,
  onChange,
  onBlockChange,
  onClose,
  onSave,
}: {
  ownerId: string;
  state: MathEditorState;
  onChange: (latex: string) => void;
  onBlockChange: (block: boolean) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const preview = useMemo(
    () =>
      state.latex.trim()
        ? renderToString(state.latex, {
            displayMode: state.type === 'blockMath',
            throwOnError: false,
            trust: false,
          })
        : '',
    [state.latex, state.type],
  );
  return (
    <div
      data-editor-owner={ownerId}
      className="fixed top-16 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border bg-background p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Công thức LaTeX</div>
          <div className="text-xs text-muted-foreground">Nhập LaTeX, ví dụ: x^2 + y^2 = z^2</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onSave}>
          Xong
        </Button>
      </div>

      <Toggle
        type="button"
        size="sm"
        variant="outline"
        pressed={state.type === 'blockMath'}
        onPressedChange={onBlockChange}
        className="mb-3 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
      >
        Tách dòng
      </Toggle>

      <input
        autoFocus
        aria-label="Mã LaTeX"
        aria-invalid={Boolean(state.error)}
        value={state.latex}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter') onSave();
        }}
        className="h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {state.error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      {preview && (
        <div
          aria-label="Xem trước công thức"
          className="mt-4 overflow-x-auto rounded-xl border bg-muted/30 p-4"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}
    </div>
  );
}

export function SimpleEditor({
  content,
  extensions,
  onUpdate,
  onReady,
  uploadImage,
  loadOriginalImage,
  loadTikzSource,
  renderTikz,
  toolbar = true,
  editorClassName = 'min-h-80 px-4 py-3 outline-none',
  frameClassName = 'min-h-80',
  ariaLabel = 'Nội dung',
  ariaLabelledBy,
}: SimpleEditorProps) {
  const ownerId = useId();
  const [active, setActive] = useState(false);
  const [mathEditor, setMathEditor] = useState<MathEditorState>();
  const [imageEditor, setImageEditor] = useState<ImageEditorState>();
  const [tikzEditor, setTikzEditor] = useState<TikzEditorState>();
  const tikzRenderGenerationRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const initialContentRef = useRef(content);
  const openMathEditorRef = useRef<
    (pos: number, type: MathNodeType, latex: string, originalType?: MathNodeType) => void
  >(() => {});
  const openExistingImageEditorRef = useRef<
    (
      pos: number,
      fileId: string,
      variantFileId: string | null,
      fileName: string,
      crop: StoredImageCrop | null,
    ) => void
  >(() => {});
  const openExistingTikzEditorRef = useRef<(pos: number, fileId: string) => void>(() => {});
  openMathEditorRef.current = (pos, type, latex, originalType) => {
    setActive(true);
    setImageEditor(undefined);
    setTikzEditor(undefined);
    setMathEditor({ pos, type, originalType, latex });
  };
  openExistingImageEditorRef.current = (pos, fileId, variantFileId, fileName, crop) => {
    if (!loadOriginalImage) return;

    const fileNameStem = imageNameStem(new File([], fileName || 'image.png'));
    const maxWidth = editor?.view.dom.clientWidth ?? 1;

    setActive(true);
    setMathEditor(undefined);
    setTikzEditor(undefined);
    setImageEditor({
      pos,
      maxWidth: Math.max(1, maxWidth),
      existing: { fileId, variantFileId, fileNameStem, crop },
      loading: true,
      uploading: false,
    });

    void loadOriginalImage(fileId)
      .then(({ blob, src }) => {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
          throw new Error('Ảnh gốc không còn đúng định dạng hỗ trợ.');
        }

        const fallbackExtension =
          blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
        const resolvedName = fileName || `image.${fallbackExtension}`;
        const file = new File([blob], resolvedName, { type: blob.type, lastModified: Date.now() });
        const previewUrl = URL.createObjectURL(file);

        setImageEditor((current) => {
          if (current?.existing?.fileId !== fileId || current.pos !== pos) {
            URL.revokeObjectURL(previewUrl);
            return current;
          }

          return {
            ...current,
            loading: false,
            file,
            fileNameStem: imageNameStem(file),
            sourceAsset: { fileId, src },
            previewUrl,
            crop: editorImageCrop(crop),
            error: undefined,
          };
        });
      })
      .catch((cause) => {
        setImageEditor((current) =>
          current?.existing?.fileId === fileId && current.pos === pos
            ? {
                ...current,
                loading: false,
                error: cause instanceof Error ? cause.message : 'Không thể tải ảnh gốc.',
              }
            : current,
        );
      });
  };

  openExistingTikzEditorRef.current = (pos, fileId) => {
    if (!renderTikz || !uploadImage || !loadTikzSource) return;

    const maxWidth = editor?.view.dom.clientWidth ?? 1;
    setActive(true);
    setMathEditor(undefined);
    setImageEditor(undefined);
    setTikzEditor({
      pos,
      maxWidth: Math.max(1, maxWidth),
      source: '',
      existingAssetId: fileId,
      loadingSource: true,
    });

    void loadTikzSource(fileId)
      .then((source) => {
        setTikzEditor((current) =>
          current?.existingAssetId === fileId && current.pos === pos
            ? {
                ...current,
                source,
                initialSource: source,
                loadingSource: false,
                error: undefined,
              }
            : current,
        );
      })
      .catch((cause) => {
        setTikzEditor((current) =>
          current?.existingAssetId === fileId && current.pos === pos
            ? {
                ...current,
                loadingSource: false,
                error:
                  cause instanceof Error ? cause.message : 'Không thể tải nguồn TikZ để chỉnh sửa.',
              }
            : current,
        );
      });
  };

  const editorProps = useMemo<EditorProps>(
    () => ({
      attributes: {
        ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : { 'aria-label': ariaLabel }),
        class: editorClassName,
      },
      handleDOMEvents: {
        dblclick: (view, event) => {
          if (!(event.target instanceof Element)) return false;

          const mathElement = event.target.closest<HTMLElement>(
            '[data-type="inline-math"], [data-type="block-math"]',
          );
          if (mathElement && view.dom.contains(mathElement)) {
            const type: MathNodeType =
              mathElement.dataset.type === 'block-math' ? 'blockMath' : 'inlineMath';
            const latex = mathElement.dataset.latex;
            if (latex === undefined) return false;

            const pos = view.posAtDOM(mathElement, 0);
            const node = view.state.doc.nodeAt(pos);
            if (node?.type.name !== type) return false;

            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            openMathEditorRef.current(pos, type, latex, type);
            return true;
          }

          const imageElement = event.target.closest<HTMLImageElement>('img[data-file-id][src]');
          if (!imageElement || !view.dom.contains(imageElement)) return false;

          const fileId = imageElement.dataset.fileId;
          if (!fileId) return false;

          const pos = view.posAtDOM(imageElement, 0);
          const node = view.state.doc.nodeAt(pos);
          if (node?.type.name !== 'image') return false;

          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
          if (node.attrs.generatorKind === 'tikz') {
            openExistingTikzEditorRef.current(pos, fileId);
            return true;
          }

          openExistingImageEditorRef.current(
            pos,
            fileId,
            typeof node.attrs.variantFileId === 'string' ? node.attrs.variantFileId : null,
            typeof node.attrs.alt === 'string' ? node.attrs.alt : '',
            storedImageCropFrom(node.attrs.crop),
          );
          return true;
        },
      },
    }),
    [ariaLabel, ariaLabelledBy, editorClassName],
  );

  const editor = useEditor({
    extensions,
    content: initialContentRef.current,
    // React Router render route này trên server; fallback xử lý lúc client mount trễ.
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps,
    onCreate: ({ editor }) => {
      ensureTerminalContinuations(editor);
      onReady?.();
    },
    onFocus: () => setActive(true),
    onUpdate: ({ editor }) => {
      const nextContent = contentForSave(editor);
      queueMicrotask(() => onUpdateRef.current?.(nextContent));
    },
  });

  useEffect(() => {
    if (!active) return undefined;

    const belongsToEditor = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest('[data-editor-owner]')?.getAttribute('data-editor-owner') === ownerId;

    const deactivate = (event: Event) => {
      if (belongsToEditor(event.target)) return;
      setActive(false);
      setMathEditor(undefined);
      setImageEditor(undefined);
      setTikzEditor(undefined);
    };

    document.addEventListener('pointerdown', deactivate, true);
    document.addEventListener('focusin', deactivate, true);
    return () => {
      document.removeEventListener('pointerdown', deactivate, true);
      document.removeEventListener('focusin', deactivate, true);
    };
  }, [active, ownerId]);

  useEffect(() => {
    const previewUrl = imageEditor?.previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [imageEditor?.previewUrl]);

  useEffect(() => {
    const previewUrl = tikzEditor?.previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [tikzEditor?.previewUrl]);

  useEffect(() => {
    const source = tikzEditor?.source;
    if (!renderTikz || !tikzEditor || tikzEditor.loadingSource || !source?.trim()) return undefined;

    const generation = ++tikzRenderGenerationRef.current;
    const timeout = window.setTimeout(() => {
      setTikzEditor((current) =>
        current && current.source === source
          ? { ...current, rendering: true, error: undefined }
          : current,
      );

      void renderTikz(source)
        .then((rendered) => {
          if (tikzRenderGenerationRef.current !== generation) return;

          const previewUrl = URL.createObjectURL(
            new Blob([rendered.svg], { type: 'image/svg+xml' }),
          );
          setTikzEditor((current) => {
            if (!current || current.source !== source) {
              URL.revokeObjectURL(previewUrl);
              return current;
            }

            return {
              ...current,
              rendering: false,
              rendered: { ...rendered, source },
              previewUrl,
              error: undefined,
            };
          });
        })
        .catch((cause) => {
          if (tikzRenderGenerationRef.current !== generation) return;
          setTikzEditor((current) =>
            current && current.source === source
              ? {
                  ...current,
                  rendering: false,
                  rendered: undefined,
                  previewUrl: undefined,
                  error: cause instanceof Error ? cause.message : 'Không thể biên dịch TikZ.',
                }
              : current,
          );
        });
    }, 400);

    return () => {
      window.clearTimeout(timeout);
      if (tikzRenderGenerationRef.current === generation) {
        tikzRenderGenerationRef.current += 1;
      }
    };
  }, [renderTikz, tikzEditor?.loadingSource, tikzEditor?.source]);

  const openNewMath = () => {
    if (!editor || !active) return;
    openMathEditorRef.current(editor.state.selection.from, 'inlineMath', '');
  };

  const openImageEditor = () => {
    if (!editor || !active) return;
    setMathEditor(undefined);
    setTikzEditor(undefined);
    setImageEditor({
      pos: editor.state.selection.from,
      maxWidth: Math.max(1, editor.view.dom.clientWidth),
      uploading: false,
    });
  };

  const openTikzEditor = () => {
    if (!editor || !active || !renderTikz || !uploadImage) return;
    setMathEditor(undefined);
    setImageEditor(undefined);
    setTikzEditor({
      pos: editor.state.selection.from,
      maxWidth: Math.max(1, editor.view.dom.clientWidth),
      source: '',
    });
  };

  const changeTikzSource = (source: string) => {
    setTikzEditor((current) =>
      current
        ? {
            ...current,
            source,
            rendered: undefined,
            previewUrl: undefined,
            error: undefined,
          }
        : current,
    );
  };

  const selectImageFile = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setImageEditor((current) =>
        current ? { ...current, error: 'Chỉ hỗ trợ PNG, JPEG hoặc WebP.' } : current,
      );
      return;
    }

    setImageEditor((current) =>
      current
        ? {
            ...current,
            file,
            fileNameStem: imageNameStem(file),
            sourceAsset: undefined,
            previewUrl: URL.createObjectURL(file),
            naturalWidth: undefined,
            naturalHeight: undefined,
            crop: { ...FULL_IMAGE_CROP },
            error: undefined,
          }
        : current,
    );
  };

  const loadImagePreview = (naturalWidth: number, naturalHeight: number) => {
    setImageEditor((current) => {
      if (!current) return current;
      const crop = current.crop ?? FULL_IMAGE_CROP;
      return {
        ...current,
        naturalWidth,
        naturalHeight,
        crop,
        error: undefined,
      };
    });
  };

  const changeImageCrop = (crop: ImageCrop) => {
    setImageEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        crop,
        error: undefined,
      };
    });
  };

  const saveImageEditor = async () => {
    if (
      !editor ||
      !uploadImage ||
      !imageEditor?.file ||
      !imageEditor.fileNameStem?.trim() ||
      !imageEditor.naturalWidth ||
      !imageEditor.naturalHeight ||
      !imageEditor.crop ||
      imageEditor.loading ||
      imageEditor.uploading
    ) {
      return;
    }

    const existing = imageEditor.existing;
    const desiredCrop = storedImageCrop(imageEditor.crop);
    const sameSource = Boolean(existing && imageEditor.sourceAsset?.fileId === existing.fileId);
    const sameCrop = Boolean(existing && sameStoredImageCrop(desiredCrop, existing.crop));
    const imageType = editor.schema.nodes.image;
    const wasEditable = editor.isEditable;
    let focusAfterSave = false;

    const currentExistingNode = () => {
      if (!existing) return undefined;

      const node = editor.state.doc.nodeAt(imageEditor.pos);
      const variantFileId =
        node?.type.name === 'image' && typeof node.attrs.variantFileId === 'string'
          ? node.attrs.variantFileId
          : null;

      if (
        node?.type.name !== 'image' ||
        node.attrs.fileId !== existing.fileId ||
        variantFileId !== existing.variantFileId ||
        !imageType
      ) {
        throw new Error('Ảnh đã thay đổi, không thể cập nhật tại vị trí cũ.');
      }

      return node;
    };

    editor.setEditable(false);
    setImageEditor({ ...imageEditor, uploading: true, error: undefined });

    try {
      const initialNode = currentExistingNode();
      const originalPrepared = await cropImageFile(
        imageEditor.file,
        imageEditor.fileNameStem,
        imageEditor.naturalWidth,
        imageEditor.naturalHeight,
        FULL_IMAGE_CROP,
      );

      if (existing && sameSource && sameCrop) {
        if (initialNode && initialNode.attrs.alt !== originalPrepared.file.name) {
          const transaction = editor.state.tr.setNodeMarkup(imageEditor.pos, undefined, {
            ...initialNode.attrs,
            alt: originalPrepared.file.name,
          });
          transaction.setSelection(NodeSelection.create(transaction.doc, imageEditor.pos));
          editor.view.dispatch(transaction);
        }
        focusAfterSave = true;
        setImageEditor(undefined);
        return;
      }

      let original: UploadedImage;
      if (sameSource && existing && imageEditor.sourceAsset) {
        original = {
          fileId: existing.fileId,
          variantFileId: null,
          src: imageEditor.sourceAsset.src,
          width: imageEditor.naturalWidth,
          height: imageEditor.naturalHeight,
        };
      } else {
        original = await uploadImage(originalPrepared.file);
        if (original.variantFileId !== null) {
          throw new Error('Upload ảnh gốc trả về variant không hợp lệ.');
        }
      }

      let rendered = original;
      if (desiredCrop) {
        const cropped = await cropImageFile(
          imageEditor.file,
          imageEditor.fileNameStem,
          imageEditor.naturalWidth,
          imageEditor.naturalHeight,
          imageEditor.crop,
        );
        rendered = await uploadImage(cropped.file, original.fileId);
        if (rendered.fileId !== original.fileId || !rendered.variantFileId) {
          throw new Error('Upload ảnh crop trả về image không hợp lệ.');
        }
      }

      const currentNode = currentExistingNode();
      const preferredWidth =
        currentNode && typeof currentNode.attrs.width === 'number'
          ? currentNode.attrs.width
          : rendered.width;
      const display = imageDisplaySize(
        rendered.width,
        rendered.height,
        preferredWidth,
        imageEditor.maxWidth,
      );
      const attrs = {
        fileId: rendered.fileId,
        variantFileId: rendered.variantFileId,
        alt: originalPrepared.file.name,
        title: currentNode ? currentNode.attrs.title : null,
        width: display.width,
        height: display.height,
        align: currentNode ? currentNode.attrs.align : 'center',
        crop: desiredCrop,
      };

      if (existing && currentNode && imageType) {
        const replacement = imageType.create(attrs);
        const transaction = editor.state.tr.replaceWith(
          imageEditor.pos,
          imageEditor.pos + currentNode.nodeSize,
          replacement,
        );
        transaction.setSelection(NodeSelection.create(transaction.doc, imageEditor.pos));
        editor.view.dispatch(transaction);
        focusAfterSave = true;
        setImageEditor(undefined);
        return;
      }

      const inserted = editor.commands.insertContentAt(imageEditor.pos, {
        type: 'image',
        attrs,
      });

      if (!inserted) throw new Error('Không thể chèn ảnh tại vị trí này.');

      ensureContinuationParagraph(editor, 'image');
      focusAfterSave = true;
      setImageEditor(undefined);
    } catch (cause) {
      setImageEditor((current) =>
        current
          ? {
              ...current,
              uploading: false,
              error: cause instanceof Error ? cause.message : 'Không thể tải ảnh',
            }
          : current,
      );
    } finally {
      editor.setEditable(wasEditable);
      if (focusAfterSave && wasEditable) editor.commands.focus();
    }
  };

  const saveTikzEditor = async () => {
    if (!editor || !uploadImage || !tikzEditor || tikzEditor.saving || tikzEditor.rendering) return;

    const source = tikzEditor.source;
    const rendered = tikzEditor.rendered;
    if (!source.trim() || !rendered || rendered.source !== source) return;

    if (tikzEditor.existingAssetId && tikzEditor.initialSource === source) {
      setTikzEditor(undefined);
      if (editor.isEditable) editor.commands.focus();
      return;
    }

    const imageType = editor.schema.nodes.image;
    if (!imageType) return;

    const currentNode = tikzEditor.existingAssetId
      ? editor.state.doc.nodeAt(tikzEditor.pos)
      : undefined;
    if (
      tikzEditor.existingAssetId &&
      (currentNode?.type.name !== 'image' ||
        currentNode.attrs.fileId !== tikzEditor.existingAssetId ||
        currentNode.attrs.generatorKind !== 'tikz')
    ) {
      setTikzEditor({ ...tikzEditor, error: 'Hình TikZ đã thay đổi tại vị trí này.' });
      return;
    }

    const wasEditable = editor.isEditable;
    editor.setEditable(false);
    setTikzEditor({ ...tikzEditor, saving: true, error: undefined });
    let focusAfterSave = false;

    try {
      const file = new File([rendered.svg], 'tikz-diagram.svg', {
        type: 'image/svg+xml',
        lastModified: Date.now(),
      });
      const uploaded = await uploadImage(file, undefined, {
        kind: 'tikz',
        source,
      });
      if (uploaded.variantFileId !== null) {
        throw new Error('Upload TikZ trả về variant không hợp lệ.');
      }

      const preferredWidth =
        currentNode && typeof currentNode.attrs.width === 'number'
          ? currentNode.attrs.width
          : uploaded.width;
      const display = imageDisplaySize(
        uploaded.width,
        uploaded.height,
        preferredWidth,
        tikzEditor.maxWidth,
      );
      const attrs = {
        fileId: uploaded.fileId,
        variantFileId: null,
        alt: 'tikz-diagram.svg',
        title: currentNode?.attrs.title ?? null,
        width: display.width,
        height: display.height,
        align: currentNode?.attrs.align ?? 'center',
        crop: null,
        generatorKind: 'tikz',
      };

      if (currentNode) {
        const replacement = imageType.create(attrs);
        const transaction = editor.state.tr.replaceWith(
          tikzEditor.pos,
          tikzEditor.pos + currentNode.nodeSize,
          replacement,
        );
        transaction.setSelection(NodeSelection.create(transaction.doc, tikzEditor.pos));
        editor.view.dispatch(transaction);
      } else {
        const inserted = editor.commands.insertContentAt(tikzEditor.pos, {
          type: 'image',
          attrs,
        });
        if (!inserted) throw new Error('Không thể chèn hình TikZ tại vị trí này.');
        ensureContinuationParagraph(editor, 'image');
      }

      focusAfterSave = true;
      setTikzEditor(undefined);
    } catch (cause) {
      setTikzEditor((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: cause instanceof Error ? cause.message : 'Không thể lưu hình TikZ.',
            }
          : current,
      );
    } finally {
      editor.setEditable(wasEditable);
      if (focusAfterSave && wasEditable) editor.commands.focus();
    }
  };

  const closeMathEditor = () => setMathEditor(undefined);
  const changeMath = (latex: string) => {
    setMathEditor((current) => (current ? { ...current, latex, error: undefined } : current));
  };
  const changeMathBlock = (block: boolean) => {
    setMathEditor((current) =>
      current
        ? { ...current, type: block ? 'blockMath' : 'inlineMath', error: undefined }
        : current,
    );
  };
  const saveMathEditor = () => {
    if (!editor || !mathEditor) return;
    const latex = mathEditor.latex.trim();
    const originalType = mathEditor.originalType;

    if (!latex) {
      if (originalType) {
        const deleted =
          originalType === 'inlineMath'
            ? editor.commands.deleteInlineMath({ pos: mathEditor.pos })
            : editor.commands.deleteBlockMath({ pos: mathEditor.pos });
        if (!deleted) {
          setMathEditor({ ...mathEditor, error: 'Không thể xóa công thức tại vị trí này.' });
          return;
        }
      }
      setMathEditor(undefined);
      return;
    }

    try {
      renderToString(latex, { throwOnError: true, trust: false });
    } catch (cause) {
      setMathEditor({
        ...mathEditor,
        error: cause instanceof Error ? cause.message : 'LaTeX không hợp lệ',
      });
      return;
    }

    let changed = false;

    if (!originalType) {
      changed =
        mathEditor.type === 'inlineMath'
          ? editor.commands.insertInlineMath({ pos: mathEditor.pos, latex })
          : editor.commands.insertBlockMath({ pos: mathEditor.pos, latex });
    } else if (mathEditor.type === originalType) {
      changed =
        originalType === 'inlineMath'
          ? editor.commands.updateInlineMath({ pos: mathEditor.pos, latex })
          : editor.commands.updateBlockMath({ pos: mathEditor.pos, latex });
    } else {
      const node = editor.state.doc.nodeAt(mathEditor.pos);
      const replacementType = editor.schema.nodes[mathEditor.type];

      if (node?.type.name === originalType && replacementType) {
        const transaction = editor.state.tr.replaceRangeWith(
          mathEditor.pos,
          mathEditor.pos + node.nodeSize,
          replacementType.create({ latex }),
        );

        if (mathEditor.type === 'inlineMath') {
          const insertedPos = transaction.mapping.map(mathEditor.pos, -1);
          const insertedWrapper = transaction.doc.nodeAt(insertedPos);

          if (insertedWrapper?.isTextblock) {
            const rightBoundary = insertedPos + insertedWrapper.nodeSize;
            if (canJoin(transaction.doc, rightBoundary)) transaction.join(rightBoundary);
            if (canJoin(transaction.doc, insertedPos)) transaction.join(insertedPos);
          }
        }

        editor.view.dispatch(transaction);
        changed = true;
      }
    }

    if (!changed) {
      setMathEditor({ ...mathEditor, error: 'Không thể lưu công thức tại vị trí này.' });
      return;
    }

    if (mathEditor.type === 'blockMath' && originalType !== 'blockMath') {
      ensureContinuationParagraph(editor, 'blockMath');
    }

    editor.commands.focus();
    setMathEditor(undefined);
  };

  return (
    <>
      {toolbar && active && (
        <HistoryToolbar
          editor={editor}
          ownerId={ownerId}
          onInsertMath={openNewMath}
          onInsertImage={uploadImage ? openImageEditor : undefined}
          onInsertTikz={uploadImage && renderTikz ? openTikzEditor : undefined}
        />
      )}

      <TableContextMenu editor={editor} ownerId={ownerId}>
        <div
          data-editor-owner={ownerId}
          className={`overflow-hidden rounded-xl border bg-background ${frameClassName}`}
        >
          <EditorContent editor={editor} className={frameClassName} />
        </div>
      </TableContextMenu>

      {mathEditor && (
        <MathEditorOverlay
          ownerId={ownerId}
          state={mathEditor}
          onChange={changeMath}
          onBlockChange={changeMathBlock}
          onClose={closeMathEditor}
          onSave={saveMathEditor}
        />
      )}

      {tikzEditor && (
        <TikzEditorOverlay
          ownerId={ownerId}
          source={tikzEditor.source}
          previewUrl={tikzEditor.previewUrl}
          editing={Boolean(tikzEditor.existingAssetId)}
          loadingSource={Boolean(tikzEditor.loadingSource)}
          rendering={Boolean(tikzEditor.rendering)}
          saving={Boolean(tikzEditor.saving)}
          error={tikzEditor.error}
          diagnostics={tikzEditor.rendered?.diagnostics ?? []}
          canSave={Boolean(
            tikzEditor.source.trim() &&
            tikzEditor.rendered?.source === tikzEditor.source &&
            !tikzEditor.loadingSource &&
            !tikzEditor.rendering &&
            !tikzEditor.saving,
          )}
          onChange={changeTikzSource}
          onClose={() => setTikzEditor(undefined)}
          onSave={() => void saveTikzEditor()}
        />
      )}

      {imageEditor && (
        <ImageEditorOverlay
          key={imageEditor.previewUrl ?? 'empty'}
          ownerId={ownerId}
          file={imageEditor.file}
          fileNameStem={imageEditor.fileNameStem}
          previewUrl={imageEditor.previewUrl}
          naturalWidth={imageEditor.naturalWidth}
          naturalHeight={imageEditor.naturalHeight}
          crop={imageEditor.crop}
          editing={Boolean(imageEditor.existing)}
          loading={imageEditor.loading}
          uploading={imageEditor.uploading}
          error={imageEditor.error}
          onFileChange={selectImageFile}
          onFileNameChange={(fileNameStem) =>
            setImageEditor((current) =>
              current ? { ...current, fileNameStem, error: undefined } : current,
            )
          }
          onImageLoad={loadImagePreview}
          onPreviewError={() =>
            setImageEditor((current) =>
              current ? { ...current, error: 'Không thể đọc ảnh này.' } : current,
            )
          }
          onCropChange={changeImageCrop}
          onClose={() => setImageEditor(undefined)}
          onSave={() => void saveImageEditor()}
        />
      )}
    </>
  );
}

export function EditorField({ label, description, ...editorProps }: EditorFieldProps) {
  const id = useId();

  return (
    <Field className="gap-2">
      {(label || description) && (
        <FieldTitle id={id}>
          {label}
          {description && <span className="font-normal text-muted-foreground">{description}</span>}
        </FieldTitle>
      )}
      <SimpleEditor
        {...editorProps}
        ariaLabel={label ?? 'Nội dung'}
        ariaLabelledBy={label ? id : undefined}
      />
    </Field>
  );
}
