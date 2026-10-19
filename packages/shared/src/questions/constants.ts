export const CHOICE_LIST_NODE_TYPE = 'choiceList';
export const CHOICE_NODE_TYPE = 'choice';
export const STATEMENT_LIST_NODE_TYPE = 'statementList';
export const STATEMENT_NODE_TYPE = 'statement';
export const PART_LIST_NODE_TYPE = 'partList';
export const PART_NODE_TYPE = 'part';

export const MULTIPLE_CHOICE_COUNT = 4;
export const TRUE_FALSE_STATEMENT_COUNT = 4;
export const SHORT_ANSWER_MAX_LENGTH = 4;
export const SHORT_ANSWER_INPUT_PATTERN = /^[\p{L}\p{N},+-]*$/u;

export type TrueFalseAnswers = Record<string, boolean | undefined>;
