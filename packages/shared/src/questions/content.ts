import { renderToString } from 'katex';
import { z } from 'zod';
import { choiceIdSchema, partIdSchema, statementIdSchema } from './child-id.js';
import {
  CHOICE_LIST_NODE_TYPE,
  CHOICE_NODE_TYPE,
  MULTIPLE_CHOICE_COUNT,
  PART_LIST_NODE_TYPE,
  PART_NODE_TYPE,
  STATEMENT_LIST_NODE_TYPE,
  STATEMENT_NODE_TYPE,
  TRUE_FALSE_STATEMENT_COUNT,
} from './constants.js';

const latexSchema = z.string().superRefine((latex, ctx) => {
  if (!latex.trim()) {
    ctx.addIssue({ code: 'custom', message: 'Công thức phải có LaTeX' });
    return;
  }

  try {
    renderToString(latex, { throwOnError: true, trust: false });
  } catch {
    ctx.addIssue({ code: 'custom', message: 'LaTeX không hợp lệ' });
  }
});

const textNodeSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
});

const inlineMathNodeSchema = z.strictObject({
  type: z.literal('inlineMath'),
  attrs: z.strictObject({ latex: latexSchema }),
});

const inlineNodeSchema = z.discriminatedUnion('type', [textNodeSchema, inlineMathNodeSchema]);

const textAlignSchema = z.enum(['left', 'center', 'right', 'justify']);

const paragraphNodeSchema = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z
    .strictObject({
      textAlign: textAlignSchema.nullable(),
    })
    .optional(),
  content: z.array(inlineNodeSchema).optional(),
});

const blockMathNodeSchema = z.strictObject({
  type: z.literal('blockMath'),
  attrs: z.strictObject({ latex: latexSchema }),
});

export const IMAGE_NODE_MAX_DIMENSION = 10_000;

const imageCropSchema = z
  .strictObject({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
  })
  .superRefine((crop, ctx) => {
    if (crop.x + crop.width > 100.0001 || crop.y + crop.height > 100.0001) {
      ctx.addIssue({ code: 'custom', message: 'Vùng crop vượt khỏi ảnh gốc' });
    }
  });

const imageNodeSchema = z
  .strictObject({
    type: z.literal('image'),
    attrs: z.strictObject({
      fileId: z.uuidv7(),
      variantFileId: z.uuidv7().nullable().default(null),
      alt: z.string().max(500).nullable(),
      title: z.string().max(500).nullable(),
      width: z.number().positive().max(IMAGE_NODE_MAX_DIMENSION).nullable(),
      height: z.number().positive().max(IMAGE_NODE_MAX_DIMENSION).nullable(),
      align: z.enum(['left', 'center', 'right']).default('center'),
      crop: imageCropSchema.nullable().default(null),
      generatorKind: z.literal('tikz').nullable().optional(),
    }),
  })
  .superRefine(({ attrs }, ctx) => {
    if ((attrs.width === null) !== (attrs.height === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attrs'],
        message: 'Kích thước ảnh phải có đủ width và height',
      });
    }
    if ((attrs.variantFileId === null) !== (attrs.crop === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attrs'],
        message: 'Ảnh crop phải có đủ variantFileId và crop',
      });
    }
    if (attrs.generatorKind === 'tikz' && (attrs.variantFileId !== null || attrs.crop !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attrs'],
        message: 'Ảnh TikZ không dùng crop variant',
      });
    }
  });

type TextNode = z.infer<typeof textNodeSchema>;
type InlineMathNode = z.infer<typeof inlineMathNodeSchema>;
type ParagraphNode = z.infer<typeof paragraphNodeSchema>;
type BlockMathNode = z.infer<typeof blockMathNodeSchema>;
type ImageNode = z.infer<typeof imageNodeSchema>;

type TableCellAttrs = {
  colspan: number;
  rowspan: number;
  colwidth: number[] | null;
  align: 'left' | 'center' | 'right' | null;
};

type TableCellNode = {
  type: 'tableCell';
  attrs: TableCellAttrs;
  content: RichBlockNode[];
};

type TableHeaderNode = {
  type: 'tableHeader';
  attrs: TableCellAttrs;
  content: RichBlockNode[];
};

type TableRowNode = {
  type: 'tableRow';
  content?: Array<TableCellNode | TableHeaderNode>;
};

export type TableNode = {
  type: 'table';
  content: TableRowNode[];
};

type RichBlockNode = ParagraphNode | BlockMathNode | ImageNode | TableNode;
export type RichNode = TextNode | InlineMathNode | RichBlockNode;

const tableCellAttrsSchema = z.strictObject({
  colspan: z.number().int().positive(),
  rowspan: z.number().int().positive(),
  colwidth: z.array(z.number().nonnegative()).nullable(),
  align: z.enum(['left', 'center', 'right']).nullable(),
});

const tableCellSchema: z.ZodType<TableCellNode> = z.strictObject({
  type: z.literal('tableCell'),
  attrs: tableCellAttrsSchema,
  content: z.array(z.lazy(() => richBlockSchema)).min(1),
});

const tableHeaderSchema: z.ZodType<TableHeaderNode> = z.strictObject({
  type: z.literal('tableHeader'),
  attrs: tableCellAttrsSchema,
  content: z.array(z.lazy(() => richBlockSchema)).min(1),
});

const tableRowSchema: z.ZodType<TableRowNode> = z.strictObject({
  type: z.literal('tableRow'),
  content: z.array(z.union([tableCellSchema, tableHeaderSchema])).optional(),
});

const tableNodeSchema: z.ZodType<TableNode> = z.strictObject({
  type: z.literal('table'),
  content: z.array(tableRowSchema).min(1),
});

const richBlockSchema: z.ZodType<RichBlockNode> = z.lazy(() =>
  z.union([paragraphNodeSchema, blockMathNodeSchema, imageNodeSchema, tableNodeSchema]),
);

export const richNodeSchema: z.ZodType<RichNode> = z.union([
  textNodeSchema,
  inlineMathNodeSchema,
  richBlockSchema,
]);

function hasMeaningfulContent(nodes: readonly RichNode[]): boolean {
  return nodes.some((node) => {
    switch (node.type) {
      case 'text':
        return Boolean(node.text.trim());
      case 'inlineMath':
      case 'blockMath':
        return Boolean(node.attrs.latex.trim());
      case 'image':
        return true;
      case 'paragraph':
        return hasMeaningfulContent(node.content ?? []);
      case 'table':
        return node.content.some((row) =>
          row.content?.some((cell) => hasMeaningfulContent(cell.content)),
        );
    }
  });
}

export const richDocumentSchema = z.strictObject({
  type: z.literal('doc'),
  content: z.array(richBlockSchema).optional(),
});

export const nonEmptyRichDocumentSchema = richDocumentSchema.refine(
  ({ content }) => hasMeaningfulContent(content ?? []),
  'Nội dung không được để trống',
);

const draftRichBlocksSchema = z.array(richBlockSchema).min(1);

const richBlocksSchema = draftRichBlocksSchema.refine(
  hasMeaningfulContent,
  'Nội dung không được để trống',
);

function uniqueIds(nodes: Array<{ attrs: { id: string } }>): boolean {
  const ids = nodes.map(({ attrs }) => attrs.id);
  return new Set(ids).size === ids.length;
}

const choiceSchema = z.strictObject({
  type: z.literal(CHOICE_NODE_TYPE),
  attrs: z.strictObject({ id: choiceIdSchema }),
  content: richBlocksSchema,
});

const choiceListSchema = z
  .strictObject({
    type: z.literal(CHOICE_LIST_NODE_TYPE),
    content: z.array(choiceSchema).length(MULTIPLE_CHOICE_COUNT),
  })
  .refine(({ content }) => uniqueIds(content), 'Choice ID phải duy nhất trong một question');

const draftChoiceSchema = choiceSchema.extend({ content: draftRichBlocksSchema });
const draftChoiceListSchema = z
  .strictObject({
    type: z.literal(CHOICE_LIST_NODE_TYPE),
    content: z.array(draftChoiceSchema).length(MULTIPLE_CHOICE_COUNT),
  })
  .refine(({ content }) => uniqueIds(content), 'Choice ID phải duy nhất trong một question');

const statementSchema = z.strictObject({
  type: z.literal(STATEMENT_NODE_TYPE),
  attrs: z.strictObject({ id: statementIdSchema }),
  content: richBlocksSchema,
});

const statementListSchema = z
  .strictObject({
    type: z.literal(STATEMENT_LIST_NODE_TYPE),
    content: z.array(statementSchema).length(TRUE_FALSE_STATEMENT_COUNT),
  })
  .refine(({ content }) => uniqueIds(content), 'Statement ID phải duy nhất trong một question');

const draftStatementSchema = statementSchema.extend({ content: draftRichBlocksSchema });
const draftStatementListSchema = z
  .strictObject({
    type: z.literal(STATEMENT_LIST_NODE_TYPE),
    content: z.array(draftStatementSchema).length(TRUE_FALSE_STATEMENT_COUNT),
  })
  .refine(({ content }) => uniqueIds(content), 'Statement ID phải duy nhất trong một question');

const partSchema = z.strictObject({
  type: z.literal(PART_NODE_TYPE),
  attrs: z.strictObject({ id: partIdSchema }),
  content: richBlocksSchema,
});

const partListSchema = z
  .strictObject({
    type: z.literal(PART_LIST_NODE_TYPE),
    content: z.array(partSchema).min(1),
  })
  .refine(({ content }) => uniqueIds(content), 'Part ID phải duy nhất trong một question');

const draftPartSchema = partSchema.extend({ content: draftRichBlocksSchema });
const draftPartListSchema = z
  .strictObject({
    type: z.literal(PART_LIST_NODE_TYPE),
    content: z.array(draftPartSchema).min(1),
  })
  .refine(({ content }) => uniqueIds(content), 'Part ID phải duy nhất trong một question');

function documentEndingWith<T extends z.ZodType>(
  domainType: string,
  domainSchema: T,
  { required = true }: { required?: boolean } = {},
) {
  return z.strictObject({
    type: z.literal('doc'),
    content: z
      .array(z.union([richBlockSchema, domainSchema]))
      .min(required ? 2 : 1)
      .superRefine((content, ctx) => {
        const nodes = content as Array<{ type: string }>;
        const last = nodes.at(-1);
        const hasDomainBeforeLast = nodes.slice(0, -1).some((node) => node.type === domainType);

        if (hasDomainBeforeLast) {
          ctx.addIssue({ code: 'custom', message: `${domainType} chỉ được nằm cuối document` });
        }
        if (required && last?.type !== domainType) {
          ctx.addIssue({ code: 'custom', message: `Document phải kết thúc bằng ${domainType}` });
        }

        const richContent = last?.type === domainType ? nodes.slice(0, -1) : nodes;
        if (!hasMeaningfulContent(richContent as RichNode[])) {
          ctx.addIssue({ code: 'custom', message: 'Nội dung câu hỏi không được để trống' });
        }
      }),
  });
}

function draftDocumentEndingWith<T extends z.ZodType>(
  domainType: string,
  domainSchema: T,
  { required = true }: { required?: boolean } = {},
) {
  return z.strictObject({
    type: z.literal('doc'),
    content: z
      .array(z.union([richBlockSchema, domainSchema]))
      .min(1)
      .superRefine((content, ctx) => {
        const nodes = content as Array<{ type: string }>;
        const last = nodes.at(-1);
        if (nodes.slice(0, -1).some((node) => node.type === domainType)) {
          ctx.addIssue({ code: 'custom', message: `${domainType} chỉ được nằm cuối document` });
        }
        if (required && last?.type !== domainType) {
          ctx.addIssue({ code: 'custom', message: `Document phải kết thúc bằng ${domainType}` });
        }
      }),
  });
}

export const draftMultipleChoiceContentSchema = draftDocumentEndingWith(
  CHOICE_LIST_NODE_TYPE,
  draftChoiceListSchema,
);
export const draftTrueFalseContentSchema = draftDocumentEndingWith(
  STATEMENT_LIST_NODE_TYPE,
  draftStatementListSchema,
);
export const draftEssayContentSchema = draftDocumentEndingWith(
  PART_LIST_NODE_TYPE,
  draftPartListSchema,
  {
    required: false,
  },
);

export const multipleChoiceContentSchema = documentEndingWith(
  CHOICE_LIST_NODE_TYPE,
  choiceListSchema,
);
export const trueFalseContentSchema = documentEndingWith(
  STATEMENT_LIST_NODE_TYPE,
  statementListSchema,
);
export const shortAnswerContentSchema = nonEmptyRichDocumentSchema;
export const essayContentSchema = documentEndingWith(PART_LIST_NODE_TYPE, partListSchema, {
  required: false,
});
