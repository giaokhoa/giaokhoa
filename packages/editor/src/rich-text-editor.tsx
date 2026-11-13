import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Extensions } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  Bold,
  Code,
  ImagePlus,
  Italic,
  List,
  Redo2,
  Sigma,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { RichTextDocument } from '@giaokhoa/contracts';
import { plainTextExtensions } from './extensions.js';
import {
  contentForSave,
  ensureTerminalContinuation,
} from './document-continuation.js';
import { MathEditorPanel, type MathNodeKind } from './math-editor-panel.js';
import { validateMathLatex } from './math.js';

const EMPTY_DOCUMENT: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

type ToolbarMark = 'bold' | 'italic' | 'strike' | 'code' | 'underline';

const TOOLBAR_MARKS: readonly { mark: ToolbarMark; title: string; Icon: LucideIcon }[] = [
  { mark: 'bold', title: 'Chữ đậm', Icon: Bold },
  { mark: 'italic', title: 'Chữ nghiêng', Icon: Italic },
  { mark: 'strike', title: 'Gạch ngang chữ', Icon: Strikethrough },
  { mark: 'code', title: 'Mã nội tuyến', Icon: Code },
  { mark: 'underline', title: 'Gạch chân', Icon: Underline },
];

export interface RichTextImagePick {
  src: string;
  alt?: string | null;
}

interface MathPanelState {
  latex: string;
  kind: MathNodeKind;
  error?: string;
  targetPos: number | null;
  targetKind: MathNodeKind | null;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export interface RichTextEditorProps {
  value?: RichTextDocument | null;
  onChange?: (document: RichTextDocument) => void;
  editable?: boolean;
  ariaLabel?: string;
  size?: 'default' | 'compact';
  toolbarSlotId?: string;
  onRequestImage?: (
    file?: File,
  ) => Promise<RichTextImagePick | null> | RichTextImagePick | null;
  extensions?: Extensions;
}

export function RichTextEditor({
  value,
  onChange,
  editable = true,
  ariaLabel,
  size = 'default',
  toolbarSlotId = 'editor-toolbar-slot',
  onRequestImage,
  extensions,
}: RichTextEditorProps) {
  const [mathPanel, setMathPanel] = useState<MathPanelState | null>(null);
  const [active, setActive] = useState(false);
  const headerTarget =
    active && typeof document !== 'undefined' ? document.getElementById(toolbarSlotId) : null;
  const ownerId = useId();
  const onRequestImageRef = useRef(onRequestImage);
  useEffect(() => {
    onRequestImageRef.current = onRequestImage;
  }, [onRequestImage]);

  function openMathPanelAt(view: EditorView, pos: number): boolean {
    const node = view.state.doc.nodeAt(pos);
    if (!node || (node.type.name !== 'inlineMath' && node.type.name !== 'blockMath')) {
      return false;
    }
    const kind = node.type.name as MathNodeKind;
    setActive(true);
    setMathPanel({
      latex: typeof node.attrs.latex === 'string' ? node.attrs.latex : '',
      kind,
      targetPos: pos,
      targetKind: kind,
    });
    return true;
  }

  const editor = useEditor({
    extensions: extensions ?? plainTextExtensions,
    content: ensureTerminalContinuation(value ?? EMPTY_DOCUMENT),
    editable,
    onFocus: () => {
      setActive(true);
    },
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handleDOMEvents: {
        dblclick: (view, event) => {
          if (!view.editable) {
            return false;
          }
          const target = event.target as HTMLElement | null;
          const mathElement = target?.closest?.(
            '[data-type="inline-math"], [data-type="block-math"]',
          );
          if (!mathElement) {
            return false;
          }
          return openMathPanelAt(view, view.posAtDOM(mathElement, 0));
        },
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
        if (files.length === 0 || !onRequestImageRef.current) {
          return false;
        }
        event.preventDefault();
        void insertImagesFromHost(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
        if (files.length === 0 || !onRequestImageRef.current) {
          return false;
        }
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coords) {
          try {
            editor.commands.setTextSelection(coords.pos);
          } catch {
          }
        }
        void insertImagesFromHost(files);
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(contentForSave(currentEditor.getJSON() as unknown as RichTextDocument));
    },
  });

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive('bold') ?? false,
      italic: currentEditor?.isActive('italic') ?? false,
      strike: currentEditor?.isActive('strike') ?? false,
      code: currentEditor?.isActive('code') ?? false,
      underline: currentEditor?.isActive('underline') ?? false,
      bulletList: currentEditor?.isActive('bulletList') ?? false,
      canUndo: currentEditor?.can().chain().undo().run() ?? false,
      canRedo: currentEditor?.can().chain().redo().run() ?? false,
    }),
  }) ?? {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    underline: false,
    bulletList: false,
    canUndo: false,
    canRedo: false,
  };

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (value === undefined) {
      return;
    }
    const nextDocument = value ?? EMPTY_DOCUMENT;
    const currentSaved = contentForSave(editor.getJSON() as unknown as RichTextDocument);
    if (JSON.stringify(currentSaved) !== JSON.stringify(contentForSave(nextDocument))) {
      editor.commands.setContent(ensureTerminalContinuation(nextDocument), {
        emitUpdate: false,
      });
    }
  }, [editor, value]);

  useEffect(() => {
    if (!active) return undefined;
    const belongsToEditor = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest('[data-editor-owner]')?.getAttribute('data-editor-owner') === ownerId;
    const deactivate = (event: Event) => {
      if (belongsToEditor(event.target)) {
        return;
      }
      setActive(false);
      setMathPanel(null);
    };
    document.addEventListener('pointerdown', deactivate, true);
    document.addEventListener('focusin', deactivate, true);
    return () => {
      document.removeEventListener('pointerdown', deactivate, true);
      document.removeEventListener('focusin', deactivate, true);
    };
  }, [active, ownerId, toolbarSlotId]);

  function toggleMark(mark: ToolbarMark): void {
    const chain = editor.chain().focus();
    switch (mark) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;
      case 'code':
        chain.toggleCode().run();
        break;
      case 'underline':
        chain.toggleUnderline().run();
        break;
    }
  }

  function toggleBulletList(): void {
    editor.chain().focus().toggleBulletList().run();
  }

  async function insertImagesFromHost(files: readonly File[]): Promise<void> {
    const requestImage = onRequestImageRef.current;
    if (!requestImage) {
      return;
    }
    const picks: RichTextImagePick[] = [];
    if (files.length === 0) {
      const pick = await requestImage();
      if (pick?.src) {
        picks.push(pick);
      }
    } else {
      for (const file of files) {
        const pick = await requestImage(file);
        if (pick?.src) {
          picks.push(pick);
        }
      }
    }
    if (picks.length === 0) {
      return;
    }
    const chain = editor.chain().focus();
    for (const pick of picks) {
      chain.setImage({ src: pick.src, alt: pick.alt ?? undefined });
    }
    chain.run();
  }

  function openMathPanel(): void {
    const { selection } = editor.state;
    if (
      selection instanceof NodeSelection &&
      (selection.node.type.name === 'inlineMath' || selection.node.type.name === 'blockMath')
    ) {
      openMathPanelAt(editor.view, selection.from);
      return;
    }
    setMathPanel({ latex: '', kind: 'inlineMath', targetPos: null, targetKind: null });
  }

  function confirmMathPanel(): void {
    if (!mathPanel) {
      return;
    }
    const validationError = validateMathLatex(mathPanel.latex);
    if (validationError) {
      setMathPanel({ ...mathPanel, error: validationError });
      return;
    }
    const { latex, kind, targetPos, targetKind } = mathPanel;
    if (targetPos === null) {
      if (kind === 'inlineMath') {
        editor.chain().focus().insertInlineMath({ latex }).run();
      } else {
        editor.chain().focus().insertBlockMath({ latex }).run();
      }
    } else if (targetKind === kind) {
      if (kind === 'inlineMath') {
        editor.chain().focus().updateInlineMath({ latex, pos: targetPos }).run();
      } else {
        editor.chain().focus().updateBlockMath({ latex, pos: targetPos }).run();
      }
    } else if (targetKind === 'inlineMath') {
      editor.chain().focus().deleteInlineMath({ pos: targetPos }).run();
      const $pos = editor.state.doc.resolve(targetPos);
      const afterParagraph = $pos.after($pos.depth);
      editor.chain().focus().insertBlockMath({ latex, pos: afterParagraph }).run();
    } else {
      editor.chain().focus().deleteBlockMath({ pos: targetPos }).run();
      editor
        .chain()
        .focus()
        .insertContentAt(targetPos, {
          type: 'paragraph',
          content: [{ type: 'inlineMath', attrs: { latex } }],
        })
        .run();
    }
    setMathPanel(null);
  }

  function deleteMathTarget(): void {
    if (!mathPanel || mathPanel.targetPos === null || !mathPanel.targetKind) {
      return;
    }
    if (mathPanel.targetKind === 'inlineMath') {
      editor.chain().focus().deleteInlineMath({ pos: mathPanel.targetPos }).run();
    } else {
      editor.chain().focus().deleteBlockMath({ pos: mathPanel.targetPos }).run();
    }
    setMathPanel(null);
  }

  const toolbar =
    editable && active ? (
      <div
        className={
          headerTarget
            ? 'giaokhoa-editor-toolbar'
            : 'giaokhoa-editor-toolbar giaokhoa-editor-toolbar--sticky'
        }
        role="toolbar"
        aria-label="Công cụ chỉnh sửa"
        data-editor-owner={ownerId}
      >
        <button
          type="button"
          className="giaokhoa-editor-toolbar__button"
          title="Hoàn tác"
          aria-label="Hoàn tác"
          disabled={!toolbarState.canUndo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
        </button>
        <button
          type="button"
          className="giaokhoa-editor-toolbar__button"
          title="Làm lại"
          aria-label="Làm lại"
          disabled={!toolbarState.canRedo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
        </button>
        <span className="giaokhoa-editor-toolbar__separator" aria-hidden="true" />
        {TOOLBAR_MARKS.map(({ mark, title, Icon }) => (
          <button
            key={mark}
            type="button"
            className="giaokhoa-editor-toolbar__button"
            title={title}
            aria-label={title}
            aria-pressed={toolbarState[mark]}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleMark(mark)}
          >
            <Icon />
          </button>
        ))}
        <button
          type="button"
          className="giaokhoa-editor-toolbar__button"
          title="Danh sách không thứ tự"
          aria-label="Danh sách không thứ tự"
          aria-pressed={toolbarState.bulletList}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleBulletList}
        >
          <List />
        </button>
        <span className="giaokhoa-editor-toolbar__separator" aria-hidden="true" />
        <button
          type="button"
          className="giaokhoa-editor-toolbar__button"
          title="Chèn công thức"
          aria-label="Chèn công thức"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openMathPanel}
        >
          <Sigma />
        </button>
        {onRequestImage ? (
          <button
            type="button"
            className="giaokhoa-editor-toolbar__button"
            title="Chèn ảnh"
            aria-label="Chèn ảnh"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void insertImagesFromHost([])}
          >
            <ImagePlus />
          </button>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      className={
        size === 'compact'
          ? 'giaokhoa-rich-text-editor giaokhoa-rich-text-editor--compact'
          : 'giaokhoa-rich-text-editor'
      }
      data-editor-owner={ownerId}
    >
      {toolbar && headerTarget ? createPortal(toolbar, headerTarget) : toolbar}
      {editable && mathPanel ? (
        <MathEditorPanel
          latex={mathPanel.latex}
          kind={mathPanel.kind}
          error={mathPanel.error}
          ownerId={ownerId}
          onLatexChange={(latex) =>
            setMathPanel((current) =>
              current ? { ...current, latex, error: undefined } : current,
            )
          }
          onKindChange={(kind) =>
            setMathPanel((current) => (current ? { ...current, kind } : current))
          }
          onConfirm={confirmMathPanel}
          onCancel={() => setMathPanel(null)}
          onDelete={mathPanel.targetPos !== null ? deleteMathTarget : undefined}
        />
      ) : null}
      <div className="giaokhoa-rich-text-editor__frame">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
