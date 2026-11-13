/**
 * Điểm xuất công khai của `@giaokhoa/editor` — barrel gom toàn bộ bề
 * mặt package dùng: trình soạn rich text dùng chung
 * (`RichTextEditor`, `RichTextView`, `MathEditorPanel`), bộ extension
 * của hợp đồng (`plainTextExtensions`), hai editor chuyên biệt
 * (trắc nghiệm `MultipleChoiceEditor`, đúng/sai chùm
 * `TrueFalseEditor`) kèm các hàm tách/gộp/kiểm tra tài liệu thống nhất
 * của chúng, các hàm chuẩn hoá đuôi tài liệu
 * (`ensureTerminalContinuation`, `contentForSave`), tiện ích công thức
 * (`renderMathHtml`, `validateMathLatex`) và các kiểu của hợp đồng
 * rich text tái xuất từ `@giaokhoa/contracts`.
 *
 * Flow tổng thể: file này không chứa logic — chỉ tái xuất; bề mặt
 * chứa (apps/web) import từ đây, và tài liệu đi qua các hàm/bộ
 * extension được xuất mà không đổi hình dạng hợp đồng (ngoại trừ tài
 * liệu thống nhất phía soạn của trắc nghiệm, bề mặt chứa phải tách về
 * hợp đồng bằng `splitMultipleChoiceDocument` trước khi lưu).
 */
export { plainTextExtensions } from './extensions.js';
export {
  CHOICE_LIST_NODE_TYPE,
  CHOICE_NODE_TYPE,
  MULTIPLE_CHOICE_COUNT,
  Choice,
  ChoiceList,
  ChoiceUniqueId,
  MultipleChoiceDocument,
  composeMultipleChoiceDocument,
  createEmptyMultipleChoiceDocument,
  isCompleteMultipleChoice,
  multipleChoiceExtensions,
  newChoiceId,
  splitMultipleChoiceDocument,
  type MultipleChoiceChoiceJson,
  type MultipleChoiceDocumentJson,
} from './multiple-choice.js';
export { MultipleChoiceEditor } from './multiple-choice-editor.js';
export type { MultipleChoiceEditorProps } from './multiple-choice-editor.js';
export {
  STATEMENT_LIST_NODE_TYPE,
  STATEMENT_NODE_TYPE,
  TRUE_FALSE_STATEMENT_COUNT,
  Statement,
  StatementList,
  StatementUniqueId,
  TrueFalseDocument,
  composeTrueFalseDocument,
  createEmptyTrueFalseDocument,
  getTrueFalseStatementIds,
  isCompleteTrueFalse,
  newStatementId,
  splitTrueFalseDocument,
  trueFalseExtensions,
  type TrueFalseDocumentJson,
  type TrueFalseStatementJson,
} from './true-false.js';
export { TrueFalseEditor } from './true-false-editor.js';
export type { TrueFalseEditorProps } from './true-false-editor.js';
export { contentForSave, ensureTerminalContinuation } from './document-continuation.js';
export { RichTextEditor } from './rich-text-editor.js';
export type { RichTextEditorProps, RichTextImagePick } from './rich-text-editor.js';
export { RichTextView } from './rich-text-view.js';
export type { RichTextViewProps } from './rich-text-view.js';
export { MathEditorPanel } from './math-editor-panel.js';
export type { MathEditorPanelProps, MathNodeKind } from './math-editor-panel.js';
export { renderMathHtml, validateMathLatex } from './math.js';
export type {
  RichTextBlockMathNode,
  RichTextBlockNode,
  RichTextBulletListNode,
  RichTextDocument,
  RichTextImageNode,
  RichTextInlineMathNode,
  RichTextInlineNode,
  RichTextListItemNode,
  RichTextMark,
  RichTextParagraphNode,
  RichTextTextNode,
} from '@giaokhoa/contracts';
