import {
  SHORT_ANSWER_INPUT_PATTERN,
  SHORT_ANSWER_MAX_LENGTH,
  shortAnswerValueSchema,
} from '@giaokhoa/shared/questions';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@giaokhoa/ui/components/input-otp';
import type { JSONContent } from '@tiptap/core';
import { memo, useId } from 'react';
import {
  EditorField,
  type LoadOriginalImage,
  type LoadTikzSource,
  type RenderTikz,
  type UploadImage,
} from '../simple-editor.js';
import { GuidanceEditor } from './guidance.js';
import { plainQuestionExtensions } from './plain-question.js';
import { TiptapContent } from './tiptap-content.js';

export function isValidShortAnswer(answer: string): boolean {
  return shortAnswerValueSchema.validate(answer);
}

function ShortAnswerInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      id={id}
      inputMode="text"
      autoComplete="off"
      pushPasswordManagerStrategy="none"
      pattern={SHORT_ANSWER_INPUT_PATTERN}
      minLength={1}
      maxLength={SHORT_ANSWER_MAX_LENGTH}
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-label="Câu trả lời ngắn"
    >
      <InputOTPGroup>
        {Array.from({ length: SHORT_ANSWER_MAX_LENGTH }, (_, index) => (
          <InputOTPSlot key={index} index={index} className="text-base" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

export function ShortAnswerEditor({
  content,
  guidance,
  answer,
  onUpdate,
  onGuidanceUpdate,
  onAnswerChange,
  uploadImage,
  loadOriginalImage,
  loadTikzSource,
  renderTikz,
}: {
  content: JSONContent;
  guidance: JSONContent;
  answer: string;
  onUpdate: (content: JSONContent) => void;
  onGuidanceUpdate: (content: JSONContent) => void;
  onAnswerChange: (answer: string) => void;
  uploadImage?: UploadImage;
  loadOriginalImage?: LoadOriginalImage;
  loadTikzSource?: LoadTikzSource;
  renderTikz?: RenderTikz;
}) {
  const answerId = useId();

  return (
    <div className="space-y-4">
      <EditorField
        content={content}
        extensions={plainQuestionExtensions}
        onUpdate={onUpdate}
        uploadImage={uploadImage}
        loadOriginalImage={loadOriginalImage}
        loadTikzSource={loadTikzSource}
        renderTikz={renderTikz}
      />
      <GuidanceEditor
        content={guidance}
        onUpdate={onGuidanceUpdate}
        uploadImage={uploadImage}
        loadOriginalImage={loadOriginalImage}
        loadTikzSource={loadTikzSource}
        renderTikz={renderTikz}
      />
      <Field orientation="horizontal" className="justify-end rounded-xl border bg-background p-3">
        <FieldLabel htmlFor={answerId} className="flex-none">
          Đáp án
        </FieldLabel>
        <ShortAnswerInput id={answerId} value={answer} onChange={onAnswerChange} />
      </Field>
    </div>
  );
}

export const ShortAnswerPreview = memo(function ShortAnswerPreview({
  content,
  answer,
}: {
  content: JSONContent;
  answer?: string;
}) {
  return (
    <div>
      <TiptapContent content={content} />
      <div className="mt-4 flex justify-end">
        <ShortAnswerInput value={answer} disabled={answer !== undefined} />
      </div>
    </div>
  );
});
