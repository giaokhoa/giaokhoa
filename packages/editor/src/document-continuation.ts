import type { RichTextBlockNode, RichTextDocument } from '@giaokhoa/contracts';

const CONTINUATION_BLOCK_TYPES: ReadonlySet<string> = new Set(['blockMath', 'image']);

function isEmptyParagraph(node: RichTextBlockNode | undefined): boolean {
  return node?.type === 'paragraph' && (node.content === undefined || node.content.length === 0);
}

export function ensureTerminalContinuation(document: RichTextDocument): RichTextDocument {
  const content = document.content ?? [];
  const last = content[content.length - 1];
  if (!last || last.type === 'paragraph' || !CONTINUATION_BLOCK_TYPES.has(last.type)) {
    return document;
  }
  return { ...document, content: [...content, { type: 'paragraph' }] };
}

export function contentForSave(document: RichTextDocument): RichTextDocument {
  const content = [...(document.content ?? [])];
  while (
    content.length > 1 &&
    isEmptyParagraph(content[content.length - 1]) &&
    CONTINUATION_BLOCK_TYPES.has(content[content.length - 2]?.type ?? '')
  ) {
    content.pop();
  }
  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }
  return { ...document, content };
}
