import { Editor, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import {
  CHOICE_LIST_NODE_TYPE,
  CHOICE_NODE_TYPE,
  MULTIPLE_CHOICE_COUNT,
  multipleChoiceExtensions,
} from './multiple-choice.js';
import {
  STATEMENT_LIST_NODE_TYPE,
  STATEMENT_NODE_TYPE,
  TRUE_FALSE_STATEMENT_COUNT,
  trueFalseExtensions,
} from './true-false.js';

describe('Bất biến id duy nhất trong tài liệu soạn thảo', () => {
  it('multipleChoice: lựa chọn thiếu attrs.id đều nhận id chuỗi riêng biệt, thứ tự nội dung không đổi', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: multipleChoiceExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Chọn đáp án đúng:' }] },
          {
            type: CHOICE_LIST_NODE_TYPE,
            content: ['A', 'B', 'C', 'D'].map((label) => ({
              type: CHOICE_NODE_TYPE,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `Phương án ${label}` }] }],
            })),
          },
        ],
      },
    });
    try {
      editor.commands.setContent(editor.getJSON());
      const json = editor.getJSON() as { content?: JSONContent[] };
      const choiceList = (json.content ?? []).find((node) => node?.type === CHOICE_LIST_NODE_TYPE);
      const choices = choiceList?.content ?? [];
      expect(choices).toHaveLength(MULTIPLE_CHOICE_COUNT);
      const ids = choices.map((choice) => choice?.attrs?.id);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(MULTIPLE_CHOICE_COUNT);
      expect(choices.map((choice) => choice?.content?.[0]?.content?.[0]?.text)).toEqual([
        'Phương án A',
        'Phương án B',
        'Phương án C',
        'Phương án D',
      ]);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it('multipleChoice: giữ nguyên id đã có và chỉ cấp id cho các lựa chọn còn thiếu', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: multipleChoiceExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          {
            type: CHOICE_LIST_NODE_TYPE,
            content: Array.from({ length: MULTIPLE_CHOICE_COUNT }, (_, index) => ({
              type: CHOICE_NODE_TYPE,
              attrs: index === 0 ? { id: 'kept-choice' } : {},
              content: [{ type: 'paragraph' }],
            })),
          },
        ],
      },
    });
    try {
      editor.commands.setContent(editor.getJSON());
      const list = (editor.getJSON().content ?? []).find((node) => node.type === CHOICE_LIST_NODE_TYPE);
      const ids = (list?.content ?? []).map((choice) => choice.attrs?.id);
      expect(ids[0]).toBe('kept-choice');
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
      expect(new Set(ids).size).toBe(MULTIPLE_CHOICE_COUNT);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it('trueFalse: mệnh đề thiếu attrs.id đều nhận id chuỗi riêng biệt, thứ tự nội dung không đổi', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: trueFalseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Xét các mệnh đề:' }] },
          {
            type: STATEMENT_LIST_NODE_TYPE,
            content: ['a', 'b', 'c', 'd'].map((label) => ({
              type: STATEMENT_NODE_TYPE,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `Mệnh đề ${label}` }] }],
            })),
          },
        ],
      },
    });
    try {
      editor.commands.setContent(editor.getJSON());
      const json = editor.getJSON() as { content?: JSONContent[] };
      const statementList = (json.content ?? []).find((node) => node?.type === STATEMENT_LIST_NODE_TYPE);
      const statements = statementList?.content ?? [];
      expect(statements).toHaveLength(TRUE_FALSE_STATEMENT_COUNT);
      const ids = statements.map((statement) => statement?.attrs?.id);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(TRUE_FALSE_STATEMENT_COUNT);
      expect(statements.map((statement) => statement?.content?.[0]?.content?.[0]?.text)).toEqual([
        'Mệnh đề a',
        'Mệnh đề b',
        'Mệnh đề c',
        'Mệnh đề d',
      ]);
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});
