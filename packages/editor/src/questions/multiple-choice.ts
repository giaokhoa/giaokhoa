import {
  CHOICE_LIST_NODE_TYPE,
  CHOICE_NODE_TYPE,
  MULTIPLE_CHOICE_COUNT,
  readyQuestionSchema,
} from '@giaokhoa/shared/questions';
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';
import { generateUniqueIds, UniqueID } from '@tiptap/extension-unique-id';
import { createEditorExtensions } from '../editor-extensions.js';

export const MultipleChoiceDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `block+ ${CHOICE_LIST_NODE_TYPE}`,
});

export const ChoiceList = Node.create({
  name: CHOICE_LIST_NODE_TYPE,
  content: `${CHOICE_NODE_TYPE}{${MULTIPLE_CHOICE_COUNT}}`,
  isolating: true,
  parseHTML: () => [{ tag: 'ol[data-choice-list]' }],
  renderHTML: () => ['ol', { 'data-choice-list': '', class: 'mt-3 list-none space-y-2 p-0' }, 0],
});

export const Choice = Node.create({
  name: CHOICE_NODE_TYPE,
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'li[data-choice]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'li',
    mergeAttributes(HTMLAttributes, {
      'data-choice': '',
      class: 'relative min-h-10 rounded-md border py-2 pl-10 pr-3',
    }),
    0,
  ],
});

export const multipleChoiceExtensions = [
  ...createEditorExtensions({ document: false }),
  MultipleChoiceDocument,
  ChoiceList,
  Choice,
  UniqueID.configure({ types: [Choice.name] }),
];

export function splitMultipleChoiceDocument(content: JSONContent): {
  question: JSONContent;
  choices: JSONContent[];
} {
  const nodes = content.content ?? [];
  const choiceListIndex = nodes.findIndex((node) => node.type === ChoiceList.name);

  if (choiceListIndex < 0) {
    return { question: content, choices: [] };
  }

  const choiceList = nodes[choiceListIndex];

  return {
    question: {
      ...content,
      content: nodes.filter((_, index) => index !== choiceListIndex),
    },
    choices: choiceList?.content?.filter((choice) => choice.type === Choice.name) ?? [],
  };
}

export function isCompleteMultipleChoice(content: JSONContent, correctChoiceId?: string): boolean {
  if (!correctChoiceId) return false;

  return readyQuestionSchema.validate({
    type: 'multiple_choice',
    content,
    solution: { choiceId: correctChoiceId },
  });
}

const emptyParagraph = (): JSONContent => ({ type: 'paragraph' });

export function createEmptyMultipleChoiceDocument(): JSONContent {
  return generateUniqueIds(
    {
      type: 'doc',
      content: [
        emptyParagraph(),
        {
          type: ChoiceList.name,
          content: Array.from({ length: MULTIPLE_CHOICE_COUNT }, () => ({
            type: Choice.name,
            content: [emptyParagraph()],
          })),
        },
      ],
    },
    multipleChoiceExtensions,
  );
}
