import type { JSONContent } from '@tiptap/core';
import { memo } from 'react';
import {
  EditorField,
  type LoadOriginalImage,
  type LoadTikzSource,
  type RenderTikz,
  type UploadImage,
} from '../simple-editor.js';
import { plainQuestionExtensions } from './plain-question.js';
import { TiptapContent } from './tiptap-content.js';

export function GuidanceEditor({
  content,
  onUpdate,
  uploadImage,
  loadOriginalImage,
  loadTikzSource,
  renderTikz,
}: {
  content: JSONContent;
  onUpdate: (content: JSONContent) => void;
  uploadImage?: UploadImage;
  loadOriginalImage?: LoadOriginalImage;
  loadTikzSource?: LoadTikzSource;
  renderTikz?: RenderTikz;
}) {
  return (
    <div className="rounded-xl bg-background p-3">
      <EditorField
        label="Hướng dẫn"
        description="(Không bắt buộc)"
        content={content}
        extensions={plainQuestionExtensions}
        onUpdate={onUpdate}
        uploadImage={uploadImage}
        loadOriginalImage={loadOriginalImage}
        loadTikzSource={loadTikzSource}
        renderTikz={renderTikz}
        editorClassName="min-h-24 px-4 py-3 outline-none"
        frameClassName="min-h-24"
      />
    </div>
  );
}

export const GuidancePreview = memo(function GuidancePreview({
  content,
}: {
  content: JSONContent;
}) {
  return (
    <div className="mt-4 rounded-xl border bg-background p-4">
      <div className="mb-1 text-sm font-medium">Hướng dẫn</div>
      <div className="leading-6">
        <TiptapContent content={content} />
      </div>
    </div>
  );
});
