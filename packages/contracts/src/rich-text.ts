import { z } from 'zod';


export const richTextMarkSchema = z.strictObject({
  type: z.enum(['bold', 'italic', 'strike', 'code', 'underline']),
});
export type RichTextMark = z.infer<typeof richTextMarkSchema>;

export const richTextTextNodeSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string(),
  marks: z.array(richTextMarkSchema).optional(),
});
export type RichTextTextNode = z.infer<typeof richTextTextNodeSchema>;

export const richTextMathAttrsSchema = z.strictObject({
  latex: z.string(),
});
export type RichTextMathAttrs = z.infer<typeof richTextMathAttrsSchema>;

export const richTextInlineMathNodeSchema = z.strictObject({
  type: z.literal('inlineMath'),
  attrs: richTextMathAttrsSchema,
});
export type RichTextInlineMathNode = z.infer<typeof richTextInlineMathNodeSchema>;

export const richTextBlockMathNodeSchema = z.strictObject({
  type: z.literal('blockMath'),
  attrs: richTextMathAttrsSchema,
});
export type RichTextBlockMathNode = z.infer<typeof richTextBlockMathNodeSchema>;

export const richTextInlineNodeSchema = z.union([
  richTextTextNodeSchema,
  richTextInlineMathNodeSchema,
]);
export type RichTextInlineNode = z.infer<typeof richTextInlineNodeSchema>;

export const richTextParagraphNodeSchema = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(richTextInlineNodeSchema).optional(),
});
export type RichTextParagraphNode = z.infer<typeof richTextParagraphNodeSchema>;

export const richTextImageNodeSchema = z.strictObject({
  type: z.literal('image'),
  attrs: z.strictObject({
    src: z.string().min(1),
    alt: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  }),
});
export type RichTextImageNode = z.infer<typeof richTextImageNodeSchema>;

export interface RichTextListItemNode {
  type: 'listItem';
  content: RichTextBlockNode[];
}

export interface RichTextBulletListNode {
  type: 'bulletList';
  content: RichTextListItemNode[];
}

export interface RichTextStatementNode {
  type: 'statement';
  attrs: { id: string };
  content: RichTextBlockNode[];
}

export interface RichTextStatementListNode {
  type: 'statementList';
  content: RichTextStatementNode[];
}

export type RichTextBlockNode =
  | RichTextParagraphNode
  | RichTextBulletListNode
  | RichTextBlockMathNode
  | RichTextImageNode
  | RichTextStatementListNode;

export const richTextListItemNodeSchema: z.ZodType<RichTextListItemNode> = z.lazy(() =>
  z.strictObject({
    type: z.literal('listItem'),
    content: z.array(richTextBlockNodeSchema).min(1),
  }),
);

export const richTextBulletListNodeSchema: z.ZodType<RichTextBulletListNode> =
  z.strictObject({
    type: z.literal('bulletList'),
    content: z.array(richTextListItemNodeSchema).min(1),
  });

export const richTextStatementNodeSchema: z.ZodType<RichTextStatementNode> = z.lazy(() =>
  z.strictObject({
    type: z.literal('statement'),
    attrs: z.strictObject({ id: z.string().min(1) }),
    content: z.array(richTextBlockNodeSchema).min(1),
  }),
);

export const richTextStatementListNodeSchema: z.ZodType<RichTextStatementListNode> =
  z.strictObject({
    type: z.literal('statementList'),
    content: z.array(richTextStatementNodeSchema),
  });

export const richTextBlockNodeSchema: z.ZodType<RichTextBlockNode> = z.lazy(() =>
  z.union([
    richTextParagraphNodeSchema,
    richTextBulletListNodeSchema,
    richTextBlockMathNodeSchema,
    richTextImageNodeSchema,
    richTextStatementListNodeSchema,
  ]),
);

export const richTextDocumentSchema = z.strictObject({
  type: z.literal('doc'),
  content: z.array(richTextBlockNodeSchema).min(1),
});
export type RichTextDocument = z.infer<typeof richTextDocumentSchema>;

export const richTextInputSchema = z.union([z.string(), richTextDocumentSchema]);
export type RichTextInput = z.infer<typeof richTextInputSchema>;

export const emptyRichTextDocument: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export function toRichTextDocument(input: string | RichTextDocument): RichTextDocument {
  if (typeof input === 'string') {
    if (input === '') {
      return { type: 'doc', content: [{ type: 'paragraph' }] };
    }
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: input }] }],
    };
  }
  return richTextDocumentSchema.parse(input);
}

function extractBlockPlainText(block: RichTextBlockNode): string {
  switch (block.type) {
    case 'paragraph':
      return (block.content ?? [])
        .map((node) => (node.type === 'text' ? node.text : node.attrs.latex))
        .join('');
    case 'blockMath':
      return block.attrs.latex;
    case 'image':
      return block.attrs.alt ?? '';
    case 'bulletList':
      return block.content
        .map((item) => item.content.map(extractBlockPlainText).join('\n'))
        .join('\n');
    case 'statementList':
      return block.content
        .map((statement) => statement.content.map(extractBlockPlainText).join('\n'))
        .join('\n');
  }
}

export function extractRichTextBlocksPlainText(blocks: readonly RichTextBlockNode[]): string {
  return blocks.map(extractBlockPlainText).join('\n');
}

export function richTextBlocksHaveContent(blocks: readonly RichTextBlockNode[]): boolean {
  return blocks.some((block) => {
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
        return block.content.some((item) => richTextBlocksHaveContent(item.content));
      case 'statementList':
        return block.content.some((statement) => richTextBlocksHaveContent(statement.content));
    }
  });
}

export function richTextBlocksContainStatementList(blocks: readonly RichTextBlockNode[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'statementList') return true;
    if (block.type === 'bulletList') {
      return block.content.some((item) => richTextBlocksContainStatementList(item.content));
    }
    return false;
  });
}

export const TRUE_FALSE_STATEMENT_COUNT = 4;

export interface TrueFalseStatementContent {
  id: string;
  content: RichTextBlockNode[];
  text: string;
}

export function getTrueFalseStatements(doc: RichTextDocument): TrueFalseStatementContent[] | null {
  const last = doc.content[doc.content.length - 1];
  if (!last || last.type !== 'statementList') {
    return null;
  }
  return last.content.map((statement) => ({
    id: statement.attrs.id,
    content: statement.content,
    text: extractRichTextBlocksPlainText(statement.content),
  }));
}

export function extractRichTextPlainText(doc: RichTextDocument): string {
  return doc.content.map(extractBlockPlainText).join('\n');
}
