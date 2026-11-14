import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';
import type { RichTextDocument } from '@giaokhoa/contracts';
import { plainTextExtensions } from './extensions.js';
import { createMissingNodeIdExtension } from './missing-node-ids.js';


export const CHOICE_LIST_NODE_TYPE = 'choiceList';

export const CHOICE_NODE_TYPE = 'choice';

export const MULTIPLE_CHOICE_COUNT = 4;

export interface MultipleChoiceChoiceJson {
  type: typeof CHOICE_NODE_TYPE;
  attrs: { id: string };
  content?: JSONContent[];
}

export interface MultipleChoiceDocumentJson {
  type: 'doc';
  content: JSONContent[];
}

let fallbackIdCounter = 0;
export function newChoiceId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  fallbackIdCounter += 1;
  return `choice-${Date.now().toString(36)}-${fallbackIdCounter}`;
}

const emptyParagraph = (): JSONContent => ({ type: 'paragraph' });

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
  renderHTML: () => ['ol', { 'data-choice-list': '', class: 'giaokhoa-choice-list' }, 0],
});

export const Choice = Node.create({
  name: CHOICE_NODE_TYPE,
  content: 'block+',
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: null },
    };
  },
  parseHTML: () => [{ tag: 'li[data-choice]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'li',
    mergeAttributes(HTMLAttributes, { 'data-choice': '', class: 'giaokhoa-choice' }),
    0,
  ],
});

export const ChoiceUniqueId = createMissingNodeIdExtension('choiceUniqueId', CHOICE_NODE_TYPE, newChoiceId);

export const multipleChoiceExtensions = [
  ...plainTextExtensions.filter((extension) => extension.name !== 'doc'),
  MultipleChoiceDocument,
  ChoiceList,
  Choice,
  ChoiceUniqueId,
];

export function splitMultipleChoiceDocument(content: MultipleChoiceDocumentJson): {
  question: JSONContent;
  choices: MultipleChoiceChoiceJson[];
} {
  const nodes = content.content ?? [];
  const choiceListIndex = nodes.findIndex((node) => node.type === CHOICE_LIST_NODE_TYPE);
  if (choiceListIndex < 0) {
    return { question: content, choices: [] };
  }
  const choiceList = nodes[choiceListIndex];
  return {
    question: { ...content, content: nodes.filter((_, index) => index !== choiceListIndex) },
    choices: (choiceList?.content ?? []).filter(
      (choice): choice is MultipleChoiceChoiceJson => choice.type === CHOICE_NODE_TYPE,
    ),
  };
}

function choiceFromBlocks(id: string, blocks: readonly JSONContent[] | undefined): MultipleChoiceChoiceJson {
  return {
    type: CHOICE_NODE_TYPE,
    attrs: { id },
    content: blocks && blocks.length > 0 ? [...blocks] : [emptyParagraph()],
  };
}

export function createEmptyMultipleChoiceDocument(): MultipleChoiceDocumentJson {
  return {
    type: 'doc',
    content: [
      emptyParagraph(),
      {
        type: CHOICE_LIST_NODE_TYPE,
        content: Array.from({ length: MULTIPLE_CHOICE_COUNT }, () =>
          choiceFromBlocks(newChoiceId(), undefined),
        ),
      },
    ],
  };
}

export function composeMultipleChoiceDocument(
  questionText: RichTextDocument | null | undefined,
  answers: readonly { id: string; answer: RichTextDocument; sortOrder: number }[],
): MultipleChoiceDocumentJson {
  const sorted = [...answers].sort((a, b) => a.sortOrder - b.sortOrder);
  const choices = sorted
    .slice(0, MULTIPLE_CHOICE_COUNT)
    .map((answer) => choiceFromBlocks(answer.id, answer.answer.content));
  while (choices.length < MULTIPLE_CHOICE_COUNT) {
    choices.push(choiceFromBlocks(newChoiceId(), undefined));
  }
  const questionBlocks = questionText?.content ?? [];
  return {
    type: 'doc',
    content: [
      ...(questionBlocks.length > 0 ? (questionBlocks as JSONContent[]) : [emptyParagraph()]),
      { type: CHOICE_LIST_NODE_TYPE, content: choices },
    ],
  };
}

export function isCompleteMultipleChoice(
  content: MultipleChoiceDocumentJson,
  correctChoiceId: string | undefined,
): boolean {
  if (!correctChoiceId) {
    return false;
  }
  const { question, choices } = splitMultipleChoiceDocument(content);
  if (choices.length !== MULTIPLE_CHOICE_COUNT) {
    return false;
  }
  const hasText = (node: JSONContent): boolean => {
    if (typeof node.text === 'string' && node.text.trim() !== '') {
      return true;
    }
    if (node.type === 'image' || node.type === 'inlineMath' || node.type === 'blockMath') {
      return true;
    }
    return (node.content ?? []).some(hasText);
  };
  if (!(question.content ?? []).some(hasText)) {
    return false;
  }
  if (!choices.some((choice) => choice.attrs.id === correctChoiceId)) {
    return false;
  }
  return choices.every((choice) => (choice.content ?? []).some(hasText));
}
