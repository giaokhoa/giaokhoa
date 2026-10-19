import type { TrueFalseAnswers } from '@giaokhoa/shared/questions';
import { Decoration, Extension, type JSONContent, type WidgetDecoration } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useId, useMemo, useRef } from 'react';
import {
  EditorField,
  type LoadOriginalImage,
  type LoadTikzSource,
  type RenderTikz,
  type UploadImage,
} from '../simple-editor.js';
import { GuidanceEditor } from './guidance.js';
import { Statement, StatementList, trueFalseExtensions } from './true-false.js';

type StatementAnswerControl = {
  groupPrefix: string;
  answers: TrueFalseAnswers;
  onAnswerChange: (statementId: string, value: boolean) => void;
};

function getStatementIds(doc: ProseMirrorNode): string[] {
  const statementList = doc.lastChild;
  if (statementList?.type.name !== StatementList.name) return [];

  const ids: string[] = [];
  statementList.forEach((statement) => {
    if (statement.type.name === Statement.name && typeof statement.attrs.id === 'string') {
      ids.push(statement.attrs.id);
    }
  });
  return ids;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createAnswerOption({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const option = document.createElement('label');
  option.className = 'flex cursor-pointer items-center gap-1.5';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.className = 'size-4 accent-primary';
  input.checked = checked;
  input.addEventListener('change', () => {
    if (input.checked) onChange();
  });

  option.append(input, document.createTextNode(label));
  return option;
}

function createStatementAnswerDecoration(controlRef: { current: StatementAnswerControl }) {
  return Extension.create({
    name: 'statementAnswerDecoration',

    addDecorations() {
      return {
        shouldUpdate: ({ oldState, newState }) =>
          !sameIds(getStatementIds(oldState.doc), getStatementIds(newState.doc)),
        create: ({ state }) => {
          const widgets: WidgetDecoration[] = [];

          state.doc.descendants((node, pos) => {
            if (node.type.name !== Statement.name) return;

            const statementId = node.attrs.id;
            if (typeof statementId !== 'string') return;

            widgets.push(
              Decoration.Widget(
                pos + 1,
                () => {
                  const wrapper = document.createElement('span');
                  wrapper.className =
                    'absolute inset-y-0 left-3 z-10 flex items-center justify-center gap-3 text-sm';

                  const name = `${controlRef.current.groupPrefix}-${statementId}`;
                  const answer = controlRef.current.answers[statementId];
                  wrapper.append(
                    createAnswerOption({
                      name,
                      label: 'Đúng',
                      checked: answer === true,
                      onChange: () => controlRef.current.onAnswerChange(statementId, true),
                    }),
                    createAnswerOption({
                      name,
                      label: 'Sai',
                      checked: answer === false,
                      onChange: () => controlRef.current.onAnswerChange(statementId, false),
                    }),
                  );
                  return wrapper;
                },
                {
                  key: `statement-answer-${statementId}`,
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

export function TrueFalseEditor({
  content,
  guidance,
  answers,
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
  answers: TrueFalseAnswers;
  onUpdate: (content: JSONContent) => void;
  onGuidanceUpdate: (content: JSONContent) => void;
  onAnswerChange: (statementId: string, value: boolean) => void;
  uploadImage?: UploadImage;
  loadOriginalImage?: LoadOriginalImage;
  loadTikzSource?: LoadTikzSource;
  renderTikz?: RenderTikz;
}) {
  const groupPrefix = useId();
  const controlRef = useRef<StatementAnswerControl>({ groupPrefix, answers, onAnswerChange });
  controlRef.current.groupPrefix = groupPrefix;
  controlRef.current.answers = answers;
  controlRef.current.onAnswerChange = onAnswerChange;

  const extensions = useMemo(
    () => [...trueFalseExtensions, createStatementAnswerDecoration(controlRef)],
    [],
  );

  return (
    <div className="space-y-4">
      <EditorField
        content={content}
        extensions={extensions}
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
    </div>
  );
}
