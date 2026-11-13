import { useCallback, useState } from 'react';
import {
  MultipleChoiceEditor,
  RichTextEditor,
  TrueFalseEditor,
  type MultipleChoiceDocumentJson,
  type RichTextImagePick,
  type TrueFalseDocumentJson,
} from '@giaokhoa/editor';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { useTranslation } from 'react-i18next';
import { QUESTION_IMAGE_ACCEPT, QuestionImageError } from '../types/question-files';
import type { QuestionFileArea } from '../types/question-files';
import { uploadQuestionImage } from '../api/question-files';
import { emptyDoc, type Doc } from '../types/form-model';


function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = QUESTION_IMAGE_ACCEPT;
    input.style.display = 'none';
    const settle = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => settle(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => settle(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function useQuestionImageHandler(
  contextId: string | undefined,
  fileArea: QuestionFileArea,
  itemId: string | undefined,
): {
  handleRequestImage: (file?: File) => Promise<RichTextImagePick | null>;
  imageError: string | null;
} {
  const { t } = useTranslation('app');
  const [imageError, setImageError] = useState<string | null>(null);
  const handleRequestImage = useCallback(
    async (file?: File): Promise<RichTextImagePick | null> => {
      if (!contextId) return null;
      const chosen = file ?? (await pickImageFile());
      if (!chosen) return null;
      try {
        const result = await uploadQuestionImage(chosen, { contextId, fileArea, itemId });
        setImageError(null);
        return { src: result.src, alt: result.alt };
      } catch (err) {
        if (err instanceof QuestionImageError && err.code === 'file.image_too_large') {
          setImageError(t('questionImageTooLarge'));
        } else if (err instanceof QuestionImageError && err.code === 'file.not_image') {
          setImageError(t('questionImageNotImage'));
        } else {
          setImageError(t('questionImageFailed'));
        }
        return null;
      }
    },
    [contextId, fileArea, itemId, t],
  );
  return { handleRequestImage, imageError };
}

export function RichField({
  label,
  value,
  onChange,
  fileArea,
  contextId,
  itemId,
  size = 'compact',
}: {
  label: string;
  value: Doc | undefined;
  onChange: (doc: Doc) => void;
  fileArea: QuestionFileArea;
  contextId?: string;
  itemId?: string;
  size?: 'default' | 'compact';
}) {
  const doc = value ?? emptyDoc();
  const { handleRequestImage, imageError } = useQuestionImageHandler(contextId, fileArea, itemId);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <RichTextEditor
        value={doc}
        onChange={onChange}
        ariaLabel={label}
        size={size}
        onRequestImage={contextId ? handleRequestImage : undefined}
      />
      {imageError ? <p className="mt-1 text-sm text-red-600">{imageError}</p> : null}
    </Field>
  );
}

export function McDocumentField({
  label,
  value,
  correctChoiceId,
  onChange,
  onCorrectChoiceChange,
  contextId,
  itemId,
}: {
  label: string;
  value: MultipleChoiceDocumentJson;
  correctChoiceId: string | undefined;
  onChange: (doc: MultipleChoiceDocumentJson) => void;
  onCorrectChoiceChange: (choiceId: string) => void;
  contextId?: string;
  itemId?: string;
}) {
  const { handleRequestImage, imageError } = useQuestionImageHandler(contextId, 'questiontext', itemId);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <MultipleChoiceEditor
        value={value}
        onChange={onChange}
        correctChoiceId={correctChoiceId}
        onCorrectChoiceChange={onCorrectChoiceChange}
        ariaLabel={label}
        onRequestImage={contextId ? handleRequestImage : undefined}
      />
      {imageError ? <p className="mt-1 text-sm text-red-600">{imageError}</p> : null}
    </Field>
  );
}

export function TfDocumentField({
  label,
  value,
  answers,
  onChange,
  onAnswerChange,
  contextId,
  itemId,
}: {
  label: string;
  value: TrueFalseDocumentJson;
  answers: Record<string, boolean | undefined>;
  onChange: (doc: TrueFalseDocumentJson) => void;
  onAnswerChange: (statementId: string, value: boolean) => void;
  contextId?: string;
  itemId?: string;
}) {
  const { handleRequestImage, imageError } = useQuestionImageHandler(contextId, 'questiontext', itemId);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <TrueFalseEditor
        value={value}
        onChange={onChange}
        answers={answers}
        onAnswerChange={onAnswerChange}
        ariaLabel={label}
        onRequestImage={contextId ? handleRequestImage : undefined}
      />
      {imageError ? <p className="mt-1 text-sm text-red-600">{imageError}</p> : null}
    </Field>
  );
}

export function numberingLabel(numbering: string, index: number): string {
  switch (numbering) {
    case 'ABC':
      return `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[index] ?? index + 1}.`;
    case '123':
      return `${index + 1}.`;
    case 'iii':
      return `${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][index] ?? index + 1}.`;
    case 'IIII':
      return `${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][index] ?? index + 1}.`;
    case 'none':
      return '';
    default:
      return `${'abcdefghijklmnopqrstuvwxyz'[index] ?? index + 1}.`;
  }
}
