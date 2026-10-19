import {
  EssayPreview,
  EssaySolutionPreview,
  GuidancePreview,
  hasTextContent,
  MultipleChoicePreview,
  ShortAnswerPreview,
  TrueFalsePreview,
} from '@giaokhoa/editor';
import type { QuestionDraft } from './draft-state';

export function PreviewPane({ draft }: { draft: QuestionDraft }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 font-medium">Bản xem trước</h2>
      <div className="rounded-xl border bg-background p-4">
        {draft.type === 'multiple_choice' && <MultipleChoicePreview content={draft.content} />}
        {draft.type === 'true_false' && <TrueFalsePreview content={draft.content} />}
        {draft.type === 'short_answer' && (
          <ShortAnswerPreview content={draft.content} answer={draft.answer} />
        )}
        {draft.type === 'essay' && <EssayPreview content={draft.content} />}
      </div>
      {hasTextContent(draft.guidance) && <GuidancePreview content={draft.guidance} />}
      {draft.type === 'essay' && hasTextContent(draft.answer) && (
        <EssaySolutionPreview answer={draft.answer} />
      )}
    </section>
  );
}
