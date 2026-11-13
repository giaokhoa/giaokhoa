import { useEffect, useId, useState, useMemo } from 'react';
import { createEditorControlStore } from './editor-control-store.js';
import { Decoration, Extension, type WidgetDecoration } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { RichTextDocument } from '@giaokhoa/contracts';
import { RichTextEditor } from './rich-text-editor.js';
import type { RichTextImagePick } from './rich-text-editor.js';
import {
  CHOICE_LIST_NODE_TYPE,
  CHOICE_NODE_TYPE,
  multipleChoiceExtensions,
  type MultipleChoiceDocumentJson,
} from './multiple-choice.js';


interface CorrectChoiceControl {
  groupName: string;
  correctChoiceId?: string;
  onCorrectChoiceChange: (choiceId: string) => void;
}

function getChoiceIds(doc: ProseMirrorNode): string[] {
  const choiceList = doc.lastChild;
  if (choiceList?.type.name !== CHOICE_LIST_NODE_TYPE) {
    return [];
  }
  const ids: string[] = [];
  choiceList.forEach((choice) => {
    if (choice.type.name === CHOICE_NODE_TYPE && typeof choice.attrs.id === 'string') {
      ids.push(choice.attrs.id);
    }
  });
  return ids;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createCorrectChoiceDecoration(getControl: () => CorrectChoiceControl) {
  return Extension.create({
    name: 'correctChoiceDecoration',

    addDecorations() {
      return {
        shouldUpdate: ({ oldState, newState }) =>
          !sameIds(getChoiceIds(oldState.doc), getChoiceIds(newState.doc)),
        create: ({ state }) => {
          const widgets: WidgetDecoration[] = [];

          state.doc.descendants((node, pos) => {
            if (node.type.name !== CHOICE_NODE_TYPE) {
              return;
            }
            const choiceId = node.attrs.id;
            if (typeof choiceId !== 'string') {
              return;
            }
            widgets.push(
              Decoration.Widget(
                pos + 1,
                () => {
                  const wrapper = document.createElement('span');
                  wrapper.className = 'giaokhoa-choice__correct';

                  const input = document.createElement('input');
                  input.type = 'radio';
                  input.name = getControl().groupName;
                  input.className = 'giaokhoa-choice__correct-input';
                  input.setAttribute('aria-label', 'Đặt làm đáp án đúng');
                  input.checked = getControl().correctChoiceId === choiceId;
                  input.addEventListener('change', () => {
                    if (input.checked) {
                      getControl().onCorrectChoiceChange(choiceId);
                    }
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

export interface MultipleChoiceEditorProps {
  value: MultipleChoiceDocumentJson;
  onChange: (document: MultipleChoiceDocumentJson) => void;
  correctChoiceId?: string;
  onCorrectChoiceChange: (choiceId: string) => void;
  ariaLabel?: string;
  onRequestImage?: (
    file?: File,
  ) => Promise<RichTextImagePick | null> | RichTextImagePick | null;
}

export function MultipleChoiceEditor({
  value,
  onChange,
  correctChoiceId,
  onCorrectChoiceChange,
  ariaLabel,
  onRequestImage,
}: MultipleChoiceEditorProps) {
  const groupName = useId();
  const [control] = useState(() => createEditorControlStore({ groupName, correctChoiceId, onCorrectChoiceChange }));
  useEffect(() => {
    control.update({ groupName, correctChoiceId, onCorrectChoiceChange });
  }, [control, groupName, correctChoiceId, onCorrectChoiceChange]);

  const extensions = useMemo(
    () => [...multipleChoiceExtensions, createCorrectChoiceDecoration(control.get)],
    [control.get],
  );

  return (
    <RichTextEditor
      value={value as unknown as RichTextDocument}
      onChange={(document) => onChange(document as unknown as MultipleChoiceDocumentJson)}
      extensions={extensions}
      ariaLabel={ariaLabel}
      onRequestImage={onRequestImage}
    />
  );
}
