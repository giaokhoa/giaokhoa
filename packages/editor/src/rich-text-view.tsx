import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import { Fragment, type ReactNode } from 'react';
import type { RichTextBlockNode, RichTextDocument } from '@giaokhoa/contracts';
import { plainTextExtensions } from './extensions.js';
import { renderMathHtml } from './math.js';

export interface RichTextViewProps {
  value: RichTextDocument | null;
}

function blockHasContent(block: RichTextBlockNode): boolean {
  switch (block.type) {
    case 'paragraph':
      return (block.content ?? []).some((node) =>
        node.type === 'text' ? node.text.trim() !== '' : node.attrs.latex.trim() !== '',
      );
    case 'blockMath':
      return block.attrs.latex.trim() !== '';
    case 'image':
      return true;
    case 'bulletList':
      return block.content.some((item) => item.content.some(blockHasContent));
    case 'statementList':
      return block.content.some((statement) => statement.content.some(blockHasContent));
  }
}

function isEmptyDocument(value: RichTextDocument): boolean {
  return !value.content.some(blockHasContent);
}

function renderPlainDocument(value: RichTextDocument): ReactNode {
  return renderToReactElement({
    extensions: plainTextExtensions,
    content: value,
    options: {
      nodeMapping: {
        inlineMath: ({ node }) => {
          const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
          return (
            <span
              data-type="inline-math"
              data-latex={latex}
              dangerouslySetInnerHTML={{ __html: renderMathHtml(latex, false) }}
            />
          );
        },
        blockMath: ({ node }) => {
          const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
          return (
            <div
              data-type="block-math"
              data-latex={latex}
              dangerouslySetInnerHTML={{ __html: renderMathHtml(latex, true) }}
            />
          );
        },
      },
    },
  });
}

export function RichTextView({ value }: RichTextViewProps): ReactNode {
  if (!value || isEmptyDocument(value)) {
    return null;
  }
  if (!value.content.some((block) => block.type === 'statementList')) {
    return renderPlainDocument(value);
  }
  const segments: ReactNode[] = [];
  let buffer: RichTextBlockNode[] = [];
  const flush = (key: string) => {
    if (buffer.length > 0) {
      const blocks = buffer;
      buffer = [];
      segments.push(
        <Fragment key={key}>{renderPlainDocument({ type: 'doc', content: blocks })}</Fragment>,
      );
    }
  };
  value.content.forEach((block, index) => {
    if (block.type !== 'statementList') {
      buffer.push(block);
      return;
    }
    flush(`stem-${index}`);
    segments.push(
      <ol key={`statements-${index}`} className="giaokhoa-statement-list">
        {block.content.map((statement) => (
          <li key={statement.attrs.id} data-statement={statement.attrs.id}>
            <RichTextView value={{ type: 'doc', content: statement.content }} />
          </li>
        ))}
      </ol>,
    );
  });
  flush('tail');
  return <>{segments}</>;
}
