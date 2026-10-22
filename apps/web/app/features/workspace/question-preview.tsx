import {
  EssayPreview,
  MultipleChoicePreview,
  ShortAnswerPreview,
  TrueFalsePreview,
  type JSONContent,
} from '@giaokhoa/editor';
import { richDocumentSchema } from '@giaokhoa/shared/questions';

export const questionTypeLabels: Record<string, string> = {
  multiple_choice: 'Trắc nghiệm',
  true_false: 'Đúng / sai',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận',
};
export function questionText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if ('text' in value && typeof value.text === 'string') return value.text;
  if (
    'attrs' in value &&
    value.attrs &&
    typeof value.attrs === 'object' &&
    'latex' in value.attrs &&
    typeof value.attrs.latex === 'string'
  )
    return value.attrs.latex;
  return 'content' in value && Array.isArray(value.content)
    ? value.content.map(questionText).join(' ').trim()
    : '';
}
export function QuestionPreview({ question }: { question: { type: string; content: unknown } }) {
  const content = question.content as JSONContent;
  switch (question.type) {
    case 'multiple_choice':
      return <MultipleChoicePreview content={content} />;
    case 'true_false':
      return <TrueFalsePreview content={content} />;
    case 'short_answer':
      return <ShortAnswerPreview content={content} />;
    default:
      return <EssayPreview content={content} />;
  }
}
export function RichDocument({ value }: { value: unknown }) {
  const result = richDocumentSchema.safeParse(value);
  return result.success ? (
    <EssayPreview content={result.data} />
  ) : (
    <p>Nội dung không đúng định dạng tài liệu.</p>
  );
}
