import { Extension, type Extensions } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Image from '@tiptap/extension-image';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { TableKit } from '@tiptap/extension-table';
import Paragraph from '@tiptap/extension-paragraph';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import TextAlign from '@tiptap/extension-text-align';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { BlockContinuation, ensureContinuationParagraph } from './block-continuation.js';

const TableSelectionCleanup = Extension.create({
  name: 'tableSelectionCleanup',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update: (view, previousState) => {
            if (
              previousState.selection instanceof CellSelection ||
              !(view.state.selection instanceof CellSelection)
            ) {
              return;
            }

            const domSelection =
              'getSelection' in view.root
                ? view.root.getSelection()
                : view.dom.ownerDocument.getSelection();
            domSelection?.removeAllRanges();
          },
        }),
      }),
    ];
  },
});

const EditableBlockMath = BlockMath.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => ensureContinuationParagraph(this.editor, 'blockMath'),
    };
  },
}).configure({ katexOptions: { displayMode: true, throwOnError: false } });

const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      imageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-image-id'),
        renderHTML: ({ imageId }) =>
          typeof imageId === 'string' && imageId ? { 'data-image-id': imageId } : {},
      },
      imageVariantId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-variant-id'),
        renderHTML: ({ imageVariantId }) =>
          typeof imageVariantId === 'string' && imageVariantId
            ? { 'data-variant-id': imageVariantId }
            : {},
      },
      crop: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-crop');
          if (!value) return null;
          try {
            const crop = JSON.parse(value) as Record<string, unknown>;
            return ['x', 'y', 'width', 'height'].every(
              (key) => typeof crop[key] === 'number' && Number.isFinite(crop[key]),
            )
              ? crop
              : null;
          } catch {
            return null;
          }
        },
        renderHTML: ({ crop }) =>
          crop && typeof crop === 'object' ? { 'data-crop': JSON.stringify(crop) } : {},
      },
      generatorKind: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-generator-kind') === 'tikz' ? 'tikz' : null,
        renderHTML: ({ generatorKind }) =>
          generatorKind === 'tikz' ? { 'data-generator-kind': 'tikz' } : {},
      },
      align: {
        default: 'center',
        parseHTML: (element) => {
          const align = element.getAttribute('data-align');
          return align === 'left' || align === 'right' ? align : 'center';
        },
        renderHTML: ({ align }) => ({
          'data-align': align === 'left' || align === 'right' ? align : 'center',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-image-id][src]' }];
  },

  addInputRules() {
    return [];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => ensureContinuationParagraph(this.editor, 'image'),
    };
  },
}).configure({
  allowBase64: false,
  HTMLAttributes: {
    class: 'block h-auto max-w-full rounded-md',
  },
  resize: {
    enabled: true,
    directions: ['bottom-right'],
    minWidth: 64,
    minHeight: 64,
    alwaysPreserveAspectRatio: true,
  },
});

export function createEditorExtensions({
  document = true,
}: { document?: boolean } = {}): Extensions {
  return [
    ...(document ? [Document] : []),
    Paragraph,
    BlockContinuation,
    TextAlign.configure({
      types: ['paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
    }),
    Text,
    EditableBlockMath,
    InlineMath.configure({ katexOptions: { displayMode: false, throwOnError: false } }),
    AssetImage,
    TableKit.configure({
      table: {
        resizable: true,
        renderWrapper: true,
      },
    }),
    TableSelectionCleanup,
    UndoRedo,
  ];
}
