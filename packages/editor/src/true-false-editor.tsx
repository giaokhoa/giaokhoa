import { useEffect, useId, useState, useMemo } from 'react';
import { createEditorControlStore } from './editor-control-store.js';
import { Decoration, Extension, type WidgetDecoration } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { RichTextDocument } from '@giaokhoa/contracts';
import { RichTextEditor } from './rich-text-editor.js';
import type { RichTextImagePick } from './rich-text-editor.js';
import {
  STATEMENT_LIST_NODE_TYPE,
  STATEMENT_NODE_TYPE,
  trueFalseExtensions,
  type TrueFalseDocumentJson,
} from './true-false.js';


interface StatementAnswerControl {
  groupPrefix: string;
  answers: Readonly<Record<string, boolean | undefined>>;
  onAnswerChange: (statementId: string, value: boolean) => void;
}

function getStatementIds(doc: ProseMirrorNode): string[] {
  const statementList = doc.lastChild;
  if (statementList?.type.name !== STATEMENT_LIST_NODE_TYPE) {
    return [];
  }
  const ids: string[] = [];
  statementList.forEach((statement) => {
    if (statement.type.name === STATEMENT_NODE_TYPE && typeof statement.attrs.id === 'string') {
      ids.push(statement.attrs.id);
    }
  });
  return ids;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createStatementAnswerDecoration(getControl: () => StatementAnswerControl) {
  return Extension.create({
    name: 'statementAnswerDecoration',

    addDecorations() {
      return {
        shouldUpdate: ({ oldState, newState }) =>
          !sameIds(getStatementIds(oldState.doc), getStatementIds(newState.doc)),
        create: ({ state }) => {
          const widgets: WidgetDecoration[] = [];

          state.doc.descendants((node, pos) => {
            if (node.type.name !== STATEMENT_NODE_TYPE) {
              return;
            }
            const statementId = node.attrs.id;
            if (typeof statementId !== 'string') {
              return;
            }
            widgets.push(
              Decoration.Widget(
                pos + 1,
                () => {
                  const wrapper = document.createElement('span');
                  wrapper.className = 'giaokhoa-statement__answer';

                  const buildOption = (value: boolean, label: string, ariaLabel: string) => {
                    const option = document.createElement('label');
                    option.className = 'giaokhoa-statement__answer-option';

                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.name = `${getControl().groupPrefix}:${statementId}`;
                    input.className = 'giaokhoa-statement__answer-input';
                    input.setAttribute('aria-label', ariaLabel);
                    input.checked = getControl().answers[statementId] === value;
                    input.addEventListener('change', () => {
                      if (input.checked) {
                        getControl().onAnswerChange(statementId, value);
                      }
                    });

                    const text = document.createElement('span');
                    text.textContent = label;

                    option.append(input, text);
                    return option;
                  };

                  wrapper.append(
                    buildOption(true, 'Đúng', 'Đánh dấu mệnh đề là Đúng'),
                    buildOption(false, 'Sai', 'Đánh dấu mệnh đề là Sai'),
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

export interface TrueFalseEditorProps {
  value: TrueFalseDocumentJson;
  onChange: (document: TrueFalseDocumentJson) => void;
  answers: Readonly<Record<string, boolean | undefined>>;
  onAnswerChange: (statementId: string, value: boolean) => void;
  ariaLabel?: string;
  onRequestImage?: (
    file?: File,
  ) => Promise<RichTextImagePick | null> | RichTextImagePick | null;
}

export function TrueFalseEditor({
  value,
  onChange,
  answers,
  onAnswerChange,
  ariaLabel,
  onRequestImage,
}: TrueFalseEditorProps) {
  const groupPrefix = useId();
  const [control] = useState(() => createEditorControlStore({ groupPrefix, answers, onAnswerChange }));
  useEffect(() => {
    control.update({ groupPrefix, answers, onAnswerChange });
  }, [control, groupPrefix, answers, onAnswerChange]);

  const extensions = useMemo(
    () => [...trueFalseExtensions, createStatementAnswerDecoration(control.get)],
    [control.get],
  );

  return (
    <RichTextEditor
      value={value as unknown as RichTextDocument}
      onChange={(document) => onChange(document as unknown as TrueFalseDocumentJson)}
      extensions={extensions}
      ariaLabel={ariaLabel}
      onRequestImage={onRequestImage}
    />
  );
}
