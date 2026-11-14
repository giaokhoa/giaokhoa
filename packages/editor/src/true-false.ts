import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';
import {
  TRUE_FALSE_STATEMENT_COUNT,
  getTrueFalseStatements,
  richTextBlocksHaveContent,
  type RichTextDocument,
} from '@giaokhoa/contracts';
import { plainTextExtensions } from './extensions.js';
import { createMissingNodeIdExtension } from './missing-node-ids.js';


export { TRUE_FALSE_STATEMENT_COUNT };

export const STATEMENT_LIST_NODE_TYPE = 'statementList';

export const STATEMENT_NODE_TYPE = 'statement';

export interface TrueFalseStatementJson {
  type: typeof STATEMENT_NODE_TYPE;
  attrs: { id: string };
  content?: JSONContent[];
}

export interface TrueFalseDocumentJson {
  type: 'doc';
  content: JSONContent[];
}

let fallbackIdCounter = 0;
export function newStatementId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  fallbackIdCounter += 1;
  return `statement-${Date.now().toString(36)}-${fallbackIdCounter}`;
}

const emptyParagraph = (): JSONContent => ({ type: 'paragraph' });

export const TrueFalseDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `block+ ${STATEMENT_LIST_NODE_TYPE}`,
});

export const StatementList = Node.create({
  name: STATEMENT_LIST_NODE_TYPE,
  content: `${STATEMENT_NODE_TYPE}{${TRUE_FALSE_STATEMENT_COUNT}}`,
  isolating: true,
  parseHTML: () => [{ tag: 'ol[data-statement-list]' }],
  renderHTML: () => ['ol', { 'data-statement-list': '', class: 'giaokhoa-statement-list' }, 0],
});

export const Statement = Node.create({
  name: STATEMENT_NODE_TYPE,
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      id: { default: null },
    };
  },
  parseHTML: () => [{ tag: 'li[data-statement]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'li',
    mergeAttributes(HTMLAttributes, { 'data-statement': '', class: 'giaokhoa-statement' }),
    0,
  ],
});

export const StatementUniqueId = createMissingNodeIdExtension('statementUniqueId', STATEMENT_NODE_TYPE, newStatementId);

export const trueFalseExtensions = [
  ...plainTextExtensions.filter((extension) => extension.name !== 'doc'),
  TrueFalseDocument,
  StatementList,
  Statement,
  StatementUniqueId,
];

export function splitTrueFalseDocument(content: TrueFalseDocumentJson): {
  stem: JSONContent;
  statements: TrueFalseStatementJson[];
} {
  const nodes = content.content ?? [];
  const listIndex = nodes.findIndex((node) => node.type === STATEMENT_LIST_NODE_TYPE);
  if (listIndex < 0) {
    return { stem: content, statements: [] };
  }
  const list = nodes[listIndex];
  return {
    stem: { ...content, content: nodes.filter((_, index) => index !== listIndex) },
    statements: (list?.content ?? []).filter(
      (statement): statement is TrueFalseStatementJson => statement.type === STATEMENT_NODE_TYPE,
    ),
  };
}

export function getTrueFalseStatementIds(content: TrueFalseDocumentJson): string[] {
  return splitTrueFalseDocument(content).statements.map((statement) => statement.attrs.id);
}

function statementFromBlocks(id: string, blocks: readonly JSONContent[] | undefined): TrueFalseStatementJson {
  return {
    type: STATEMENT_NODE_TYPE,
    attrs: { id },
    content: blocks && blocks.length > 0 ? [...blocks] : [emptyParagraph()],
  };
}

export function createEmptyTrueFalseDocument(): TrueFalseDocumentJson {
  return {
    type: 'doc',
    content: [
      emptyParagraph(),
      {
        type: STATEMENT_LIST_NODE_TYPE,
        content: Array.from({ length: TRUE_FALSE_STATEMENT_COUNT }, () =>
          statementFromBlocks(newStatementId(), undefined),
        ),
      },
    ],
  };
}

export function composeTrueFalseDocument(
  questionText: RichTextDocument | null | undefined,
): TrueFalseDocumentJson {
  const source = (questionText?.content ?? []) as JSONContent[];
  const { stem, statements } = splitTrueFalseDocument({ type: 'doc', content: source });
  const normalised = statements
    .slice(0, TRUE_FALSE_STATEMENT_COUNT)
    .map((statement) => statementFromBlocks(statement.attrs.id, statement.content));
  while (normalised.length < TRUE_FALSE_STATEMENT_COUNT) {
    normalised.push(statementFromBlocks(newStatementId(), undefined));
  }
  const stemBlocks = stem.content ?? [];
  return {
    type: 'doc',
    content: [
      ...(stemBlocks.length > 0 ? stemBlocks : [emptyParagraph()]),
      { type: STATEMENT_LIST_NODE_TYPE, content: normalised },
    ],
  };
}

export function isCompleteTrueFalse(
  content: TrueFalseDocumentJson,
  answers: Readonly<Record<string, boolean | undefined>>,
): boolean {
  const doc = content as unknown as RichTextDocument;
  const statements = getTrueFalseStatements(doc);
  if (!statements || statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
    return false;
  }
  const stemBlocks = doc.content.slice(0, -1);
  if (!richTextBlocksHaveContent(stemBlocks)) {
    return false;
  }
  return statements.every(
    (statement) =>
      richTextBlocksHaveContent(statement.content) && typeof answers[statement.id] === 'boolean',
  );
}
