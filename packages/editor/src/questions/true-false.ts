import {
  readyQuestionSchema,
  STATEMENT_LIST_NODE_TYPE,
  STATEMENT_NODE_TYPE,
  TRUE_FALSE_STATEMENT_COUNT,
  type TrueFalseAnswers,
} from '@giaokhoa/shared/questions';
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';
import { generateUniqueIds, UniqueID } from '@tiptap/extension-unique-id';
import { createEditorExtensions } from '../editor-extensions.js';

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
  renderHTML: () => ['ol', { 'data-statement-list': '', class: 'mt-3 list-none space-y-2 p-0' }, 0],
});

export const Statement = Node.create({
  name: STATEMENT_NODE_TYPE,
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'li[data-statement]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'li',
    mergeAttributes(HTMLAttributes, {
      'data-statement': '',
      class: 'relative grid min-h-12 content-center rounded-md border py-2 pl-36 pr-3',
    }),
    0,
  ],
});

export const trueFalseExtensions = [
  ...createEditorExtensions({ document: false }),
  TrueFalseDocument,
  StatementList,
  Statement,
  UniqueID.configure({ types: [Statement.name] }),
];

export function splitTrueFalseDocument(content: JSONContent): {
  question: JSONContent;
  statements: JSONContent[];
} {
  const nodes = content.content ?? [];
  const statementListIndex = nodes.findIndex((node) => node.type === StatementList.name);

  if (statementListIndex < 0) {
    return { question: content, statements: [] };
  }

  const statementList = nodes[statementListIndex];
  return {
    question: {
      ...content,
      content: nodes.filter((_, index) => index !== statementListIndex),
    },
    statements:
      statementList?.content?.filter((statement) => statement.type === Statement.name) ?? [],
  };
}

export function getTrueFalseStatementIds(content: JSONContent): string[] {
  return splitTrueFalseDocument(content).statements.flatMap((statement) =>
    typeof statement.attrs?.id === 'string' ? [statement.attrs.id] : [],
  );
}

export function isCompleteTrueFalse(content: JSONContent, answers: TrueFalseAnswers): boolean {
  const statementIds = getTrueFalseStatementIds(content);

  return readyQuestionSchema.validate({
    type: 'true_false',
    content,
    solution: {
      answers: statementIds.map((statementId) => ({
        statementId,
        value: answers[statementId],
      })),
    },
  });
}

const emptyParagraph = (): JSONContent => ({ type: 'paragraph' });

export function createEmptyTrueFalseDocument(): JSONContent {
  return generateUniqueIds(
    {
      type: 'doc',
      content: [
        emptyParagraph(),
        {
          type: StatementList.name,
          content: Array.from({ length: TRUE_FALSE_STATEMENT_COUNT }, () => ({
            type: Statement.name,
            content: [emptyParagraph()],
          })),
        },
      ],
    },
    trueFalseExtensions,
  );
}
