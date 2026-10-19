import type { JSONContent } from '@tiptap/core';
import { memo } from 'react';
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

export function EssayEditor({
  content,
  guidance,
  answer,
  onUpdate,
  onGuidanceUpdate,
  onAnswerUpdate,
  uploadImage,
  loadOriginalImage,
  loadTikzSource,
  renderTikz,
}: {
  content: JSONContent;
  guidance: JSONContent;
  answer: JSONContent;
  onUpdate: (content: JSONContent) => void;
  onGuidanceUpdate: (content: JSONContent) => void;
  onAnswerUpdate: (answer: JSONContent) => void;
  uploadImage?: UploadImage;
  loadOriginalImage?: LoadOriginalImage;
  loadTikzSource?: LoadTikzSource;
  renderTikz?: RenderTikz;
}) {
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
      <div className="rounded-xl bg-background p-3">
        <EditorField
          label="Đáp án"
          content={answer}
          extensions={plainQuestionExtensions}
          onUpdate={onAnswerUpdate}
          uploadImage={uploadImage}
          loadOriginalImage={loadOriginalImage}
          loadTikzSource={loadTikzSource}
          renderTikz={renderTikz}
          editorClassName="min-h-32 px-4 py-3 outline-none"
          frameClassName="min-h-32"
        />
      </div>
    </div>
  );
}

export const EssayPreview = memo(function EssayPreview({ content }: { content: JSONContent }) {
  return (
    <div className="min-h-16">
      <TiptapContent content={content} />
    </div>
  );
});

export const EssaySolutionPreview = memo(function EssaySolutionPreview({
  answer,
}: {
  answer: JSONContent;
}) {
  return (
    <div className="mt-4 rounded-xl border bg-background p-4">
      <div className="mb-2 text-sm font-medium">Đáp án</div>
      <div className="leading-6">
        <TiptapContent content={answer} />
      </div>
    </div>
  );
});
