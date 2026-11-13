import type { Editor, Extensions } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import Document from '@tiptap/extension-document';
import Image from '@tiptap/extension-image';
import Italic from '@tiptap/extension-italic';
import { BulletList, ListItem } from '@tiptap/extension-list';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';
import { UndoRedo } from '@tiptap/extensions';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import './math.js';

function ensureContinuationParagraph(editor: Editor, nodeName: string): boolean {
  const { selection, doc, schema } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== nodeName) {
    return false;
  }
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) {
    return false;
  }
  const pos = selection.from;
  const afterPos = pos + selection.node.nodeSize;
  const $pos = doc.resolve(pos);
  const index = $pos.index();
  const nextNode = $pos.parent.maybeChild(index + 1);
  if (nextNode?.type === paragraphType && nextNode.content.size === 0) {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, afterPos + 1)).scrollIntoView(),
    );
    return true;
  }
  if (!$pos.parent.canReplaceWith(index + 1, index + 1, paragraphType)) {
    return false;
  }
  const paragraph = paragraphType.createAndFill();
  if (!paragraph) {
    return false;
  }
  const transaction = editor.state.tr.insert(afterPos, paragraph);
  transaction.setSelection(TextSelection.create(transaction.doc, afterPos + 1));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

const ContinuableBlockMath = BlockMath.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => ensureContinuationParagraph(this.editor, 'blockMath'),
    };
  },
});

const ContinuableImage = Image.extend({
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => ensureContinuationParagraph(this.editor, 'image'),
    };
  },
});

export const plainTextExtensions: Extensions = [
  Document,
  Paragraph,
  Text,
  UndoRedo,
  Bold,
  Italic,
  Strike,
  Code,
  Underline,
  BulletList,
  ListItem,
  InlineMath.configure({
    katexOptions: { displayMode: false, throwOnError: false },
  }),
  ContinuableBlockMath.configure({
    katexOptions: { displayMode: true, throwOnError: false },
  }),
  ContinuableImage.configure({ allowBase64: false }),
];
