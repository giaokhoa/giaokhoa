import {
  EssayEditor,
  MultipleChoiceEditor,
  ShortAnswerEditor,
  TrueFalseEditor,
  type LoadOriginalImage,
  type LoadTikzSource,
  type RenderTikz,
  type UploadImage,
} from '@giaokhoa/editor';
import { memo, type ReactNode } from 'react';
import type { QuestionDraft } from './draft-state';

type DraftUpdater = (draft: QuestionDraft) => QuestionDraft;

type AuthoringPaneProps = {
  draft: QuestionDraft;
  onChange: (update: DraftUpdater) => void;
  uploadImage: UploadImage;
  loadOriginalImage: LoadOriginalImage;
  loadTikzSource: LoadTikzSource;
  renderTikz: RenderTikz;
};

export const AuthoringPane = memo(function AuthoringPane({
  draft,
  onChange,
  uploadImage,
  loadOriginalImage,
  loadTikzSource,
  renderTikz,
}: AuthoringPaneProps) {
  let editor: ReactNode;

  switch (draft.type) {
    case 'multiple_choice':
      editor = (
        <MultipleChoiceEditor
          content={draft.content}
          guidance={draft.guidance}
          correctChoiceId={draft.correctChoiceId}
          onUpdate={(content) =>
            onChange((current) =>
              current.type === 'multiple_choice' ? { ...current, content } : current,
            )
          }
          onGuidanceUpdate={(guidance) =>
            onChange((current) =>
              current.type === 'multiple_choice' ? { ...current, guidance } : current,
            )
          }
          onCorrectChoiceChange={(correctChoiceId) =>
            onChange((current) =>
              current.type === 'multiple_choice' ? { ...current, correctChoiceId } : current,
            )
          }
          uploadImage={uploadImage}
          loadOriginalImage={loadOriginalImage}
          loadTikzSource={loadTikzSource}
          renderTikz={renderTikz}
        />
      );
      break;
    case 'true_false':
      editor = (
        <TrueFalseEditor
          content={draft.content}
          guidance={draft.guidance}
          answers={draft.answers}
          onUpdate={(content) =>
            onChange((current) =>
              current.type === 'true_false' ? { ...current, content } : current,
            )
          }
          onGuidanceUpdate={(guidance) =>
            onChange((current) =>
              current.type === 'true_false' ? { ...current, guidance } : current,
            )
          }
          onAnswerChange={(statementId, value) =>
            onChange((current) =>
              current.type === 'true_false'
                ? {
                    ...current,
                    answers: { ...current.answers, [statementId]: value },
                  }
                : current,
            )
          }
          uploadImage={uploadImage}
          loadOriginalImage={loadOriginalImage}
          loadTikzSource={loadTikzSource}
          renderTikz={renderTikz}
        />
      );
      break;
    case 'short_answer':
      editor = (
        <ShortAnswerEditor
          content={draft.content}
          guidance={draft.guidance}
          answer={draft.answer}
          onUpdate={(content) =>
            onChange((current) =>
              current.type === 'short_answer' ? { ...current, content } : current,
            )
          }
          onGuidanceUpdate={(guidance) =>
            onChange((current) =>
              current.type === 'short_answer' ? { ...current, guidance } : current,
            )
          }
          onAnswerChange={(answer) =>
            onChange((current) =>
              current.type === 'short_answer' ? { ...current, answer } : current,
            )
          }
          uploadImage={uploadImage}
          loadOriginalImage={loadOriginalImage}
          loadTikzSource={loadTikzSource}
          renderTikz={renderTikz}
        />
      );
      break;
    case 'essay':
      editor = (
        <EssayEditor
          content={draft.content}
          guidance={draft.guidance}
          answer={draft.answer}
          onUpdate={(content) =>
            onChange((current) => (current.type === 'essay' ? { ...current, content } : current))
          }
          onGuidanceUpdate={(guidance) =>
            onChange((current) => (current.type === 'essay' ? { ...current, guidance } : current))
          }
          onAnswerUpdate={(answer) =>
            onChange((current) => (current.type === 'essay' ? { ...current, answer } : current))
          }
          uploadImage={uploadImage}
          loadOriginalImage={loadOriginalImage}
          loadTikzSource={loadTikzSource}
          renderTikz={renderTikz}
        />
      );
      break;
  }

  return (
    <section className="min-w-0">
      <h2 className="mb-2 font-medium">Soạn câu hỏi</h2>
      {editor}
    </section>
  );
});
