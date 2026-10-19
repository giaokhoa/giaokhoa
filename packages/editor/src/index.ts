import 'katex/dist/katex.min.css';
import './editor.css';

export {
  createEmptyMultipleChoiceDocument,
  isCompleteMultipleChoice,
} from './questions/multiple-choice.js';
export { MultipleChoiceEditor } from './questions/multiple-choice-editor.js';
export { MultipleChoicePreview } from './questions/multiple-choice-preview.js';
export {
  createEmptyTrueFalseDocument,
  getTrueFalseStatementIds,
  isCompleteTrueFalse,
} from './questions/true-false.js';
export type { TrueFalseAnswers } from '@giaokhoa/shared/questions';
export { TrueFalseEditor } from './questions/true-false-editor.js';
export { TrueFalsePreview } from './questions/true-false-preview.js';
export { createEmptyPlainQuestionDocument } from './questions/plain-question.js';
export { GuidancePreview } from './questions/guidance.js';
export {
  isValidShortAnswer,
  ShortAnswerEditor,
  ShortAnswerPreview,
} from './questions/short-answer.js';
export { EssayEditor, EssayPreview, EssaySolutionPreview } from './questions/essay.js';
export { hasTextContent } from './questions/tiptap-content.js';
export type { JSONContent } from '@tiptap/core';
export type {
  LoadOriginalImage,
  LoadTikzSource,
  RenderTikz,
  RenderTikzResult,
  TikzDiagnostic,
  UploadImage,
  UploadedImage,
} from './simple-editor.js';
