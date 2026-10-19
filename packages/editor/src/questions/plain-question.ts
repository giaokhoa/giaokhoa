import type { JSONContent } from '@tiptap/core';
import { createEditorExtensions } from '../editor-extensions.js';

export const plainQuestionExtensions = createEditorExtensions();

export function createEmptyPlainQuestionDocument(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}
