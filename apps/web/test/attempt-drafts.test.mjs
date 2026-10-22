import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAutoSave,
  clearDraft,
  readDraft,
  writeDraft,
} from '../app/features/attempts/draft-storage.ts';

function browser() {
  const entries = new Map();
  return {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
  };
}

const blank = { choiceId: '', statements: {}, answer: '', parts: {} };

void test('khôi phục bản nháp đúng sai chỉ có hai trong bốn mệnh đề sau khi đóng trang', () => {
  const host = browser();
  const key = 'giaokhoa:attempt:example:question:1';
  const partial = { ...blank, statements: { a: true, c: false } };
  assert.equal(writeDraft(host, key, partial), true);
  assert.deepEqual(readDraft(host, key), partial);
  assert.equal(canAutoSave(null, null), false);
});

void test('giữ nguyên phần tự luận dài khi các phần khác còn bỏ trống', () => {
  const host = browser();
  const key = 'giaokhoa:attempt:example:question:2';
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lời giải đang viết dở' }] }],
  };
  const partial = { ...blank, parts: { first: content } };
  writeDraft(host, key, partial);
  assert.deepEqual(readDraft(host, key)?.parts.first, content);
  clearDraft(host, key);
  assert.equal(readDraft(host, key), null);
});

void test('lưu thất bại không tự lặp vô hạn, nhưng câu trả lời sửa lại được tự lưu tiếp', () => {
  const failed = '{"type":"short_answer","answer":"1"}';
  const edited = '{"type":"short_answer","answer":"12"}';
  assert.equal(canAutoSave(failed, failed), false);
  assert.equal(canAutoSave(edited, failed), true);
  assert.equal(canAutoSave(edited, null), true);
});

void test('không dùng bản nháp không đúng định dạng hoặc khi bộ nhớ trình duyệt bị khóa', () => {
  const host = browser();
  host.localStorage.setItem('invalid', '{');
  assert.equal(readDraft(host, 'invalid'), null);
  const blocked = {
    get localStorage() {
      throw new Error('Storage disabled');
    },
  };
  assert.equal(readDraft(blocked, 'x'), null);
  assert.equal(writeDraft(blocked, 'x', blank), false);
  assert.doesNotThrow(() => clearDraft(blocked, 'x'));
});
