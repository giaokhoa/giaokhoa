import { Decoration, Extension, type JSONContent, type WidgetDecoration } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useId, useMemo, useRef, useState } from 'react';
import {
  EditorField,
  type LoadOriginalImage,
  type LoadTikzSource,
  type RenderTikz,
  type UploadImage,
} from '../simple-editor.js';
import { GuidanceEditor } from './guidance.js';
import {
  Choice,
  ChoiceList,
  multipleChoiceExtensions,
  splitMultipleChoiceDocument,
} from './multiple-choice.js';
import { TiptapContent, getTextContent } from './tiptap-content.js';

type CorrectChoiceControl = {
  groupName: string;
  correctChoiceId?: string;
  onCorrectChoiceChange: (choiceId: string) => void;
};

function getChoiceIds(doc: ProseMirrorNode): string[] {
  const choiceList = doc.lastChild;
  if (choiceList?.type.name !== ChoiceList.name) return [];

  const ids: string[] = [];
  choiceList.forEach((choice) => {
    if (choice.type.name === Choice.name && typeof choice.attrs.id === 'string') {
      ids.push(choice.attrs.id);
    }
  });
  return ids;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createCorrectChoiceDecoration(controlRef: { current: CorrectChoiceControl }) {
  return Extension.create({
    name: 'correctChoiceDecoration',

    addDecorations() {
      return {
        shouldUpdate: ({ oldState, newState }) =>
          !sameIds(getChoiceIds(oldState.doc), getChoiceIds(newState.doc)),
        create: ({ state }) => {
          const widgets: WidgetDecoration[] = [];

          state.doc.descendants((node, pos) => {
            if (node.type.name !== Choice.name) return;

            const choiceId = node.attrs.id;
            if (typeof choiceId !== 'string') return;

            widgets.push(
              Decoration.Widget(
                pos + 1,
                () => {
                  const wrapper = document.createElement('span');
                  wrapper.className =
                    'absolute left-3 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center';

                  const input = document.createElement('input');
                  input.type = 'radio';
                  input.name = controlRef.current.groupName;
                  input.className = 'size-4 cursor-pointer accent-primary';
                  input.setAttribute('aria-label', 'Đặt làm đáp án đúng');
                  input.checked = controlRef.current.correctChoiceId === choiceId;
                  input.addEventListener('change', () => {
                    if (input.checked) controlRef.current.onCorrectChoiceChange(choiceId);
                  });

                  wrapper.append(input);
                  return wrapper;
                },
                {
                  key: `correct-choice-${choiceId}`,
                  side: -1,
                  ignoreSelection: true,
                  stopEvent: () => true,
                },
              ),
            );
          });

          return widgets;
        },
      };
    },
  });
}

function MultipleChoiceEditorFallback({
  content,
  correctChoiceId,
}: {
  content: JSONContent;
  correctChoiceId?: string;
}) {
  const { question, choices } = splitMultipleChoiceDocument(content);

  return (
    <div
      aria-hidden="true"
      className="mc-editor-fallback pointer-events-none absolute inset-px z-10 min-h-[calc(20rem-2px)] rounded-[calc(var(--radius-xl)-1px)] bg-background px-4 py-3"
    >
      {getTextContent(question) ? <TiptapContent content={question} /> : <div className="h-6" />}
      <ol className="mt-3 list-none space-y-2 p-0">
        {choices.map((choice, index) => {
          const id = typeof choice.attrs?.id === 'string' ? choice.attrs.id : String(index);
          const selected = correctChoiceId === id;
          return (
            <li key={id} className="relative min-h-10 rounded-md border py-2 pr-3 pl-10">
              <span
                data-radio-placeholder
                className="absolute top-1/2 left-3 flex size-5 -translate-y-1/2 items-center justify-center"
              >
                <input
                  type="radio"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="size-4 accent-primary"
                  checked={selected}
                  readOnly
                />
              </span>
              {getTextContent(choice) ? (
                <TiptapContent content={{ type: 'doc', content: choice.content }} />
              ) : (
                <div className="h-6" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function MultipleChoiceEditor({
  content,
  guidance,
  correctChoiceId,
  onUpdate,
  onGuidanceUpdate,
  onCorrectChoiceChange,
  uploadImage,
  loadOriginalImage,
  loadTikzSource,
  renderTikz,
}: {
  content: JSONContent;
  guidance: JSONContent;
  correctChoiceId?: string;
  onUpdate: (content: JSONContent) => void;
  onGuidanceUpdate: (content: JSONContent) => void;
  onCorrectChoiceChange: (choiceId: string) => void;
  uploadImage?: UploadImage;
  loadOriginalImage?: LoadOriginalImage;
  loadTikzSource?: LoadTikzSource;
  renderTikz?: RenderTikz;
}) {
  const [editorReady, setEditorReady] = useState(false);
  const groupName = useId();
  const controlRef = useRef<CorrectChoiceControl>({
    groupName,
    correctChoiceId,
    onCorrectChoiceChange,
  });
  controlRef.current.groupName = groupName;
  controlRef.current.correctChoiceId = correctChoiceId;
  controlRef.current.onCorrectChoiceChange = onCorrectChoiceChange;

  const extensions = useMemo(
    () => [...multipleChoiceExtensions, createCorrectChoiceDecoration(controlRef)],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="mc-editor-shell relative">
        <EditorField
          content={content}
          extensions={extensions}
          onUpdate={onUpdate}
          onReady={() => setEditorReady(true)}
          uploadImage={uploadImage}
          loadOriginalImage={loadOriginalImage}
          loadTikzSource={loadTikzSource}
          renderTikz={renderTikz}
        />
        {!editorReady && (
          <MultipleChoiceEditorFallback content={content} correctChoiceId={correctChoiceId} />
        )}
      </div>
      <GuidanceEditor
        content={guidance}
        onUpdate={onGuidanceUpdate}
        uploadImage={uploadImage}
        loadOriginalImage={loadOriginalImage}
        loadTikzSource={loadTikzSource}
        renderTikz={renderTikz}
      />
    </div>
  );
}
