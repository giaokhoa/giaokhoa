import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autosaveDelay,
  clearDraft,
  draftConflicts,
  readDraft,
  shouldClearDraft,
  shouldRestoreDraft,
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

void test('khôi phục bản nháp đúng sai mới trả lời hai trong bốn mệnh đề', () => {
  const host = browser();
  const key = 'giaokhoa:attempt:example:question:1';
  const partial = { ...blank, statements: { a: true, c: false } };
  assert.equal(writeDraft(host, key, partial, null), true);
  const saved = readDraft(host, key);
  assert.deepEqual(saved?.draft, partial);
  assert.equal(draftConflicts(saved, null), false);
  assert.equal(autosaveDelay(null, null, 0), null);
});

void test('tự luận nhiều phần chưa hoàn chỉnh được giữ và phục hồi', () => {
  const host = browser();
  const key = 'giaokhoa:attempt:example:question:2';
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lời giải đang viết dở' }] }],
  };
  const partial = { ...blank, parts: { first: content } };
  writeDraft(host, key, partial, '2026-10-22T01:00:00.000Z');
  assert.deepEqual(readDraft(host, key)?.draft.parts.first, content);
  clearDraft(host, key);
  assert.equal(readDraft(host, key), null);
});

void test('nháp X trên thiết bị A không thể tự ghi đè đáp án Y mới hơn từ thiết bị B', () => {
  const hostA = browser();
  const key = 'giaokhoa:attempt:example:question:3';
  const base = '2026-10-22T01:00:00.000Z';
  const serverAfterB = '2026-10-22T01:01:00.000Z';
  writeDraft(hostA, key, { ...blank, answer: 'X' }, base);
  const restored = readDraft(hostA, key);
  assert.equal(draftConflicts(restored, serverAfterB), true);
  // Chỉ sau khi học sinh tự chọn bản cục bộ mới gắn baseline mới cho phép đồng bộ.
  writeDraft(hostA, key, restored.draft, serverAfterB);
  assert.equal(draftConflicts(readDraft(hostA, key), serverAfterB), false);
});

void test('nháp cũ không có phiên bản phải hỏi trước khi cho phép ghi đè', () => {
  const host = browser();
  host.localStorage.setItem('legacy', JSON.stringify({ ...blank, answer: 'X' }));
  const restored = readDraft(host, 'legacy');
  assert.equal(restored.draft.answer, 'X');
  assert.equal(draftConflicts(restored, null), true);
});

void test('mạng mất rồi phục hồi không cần sửa câu: tự thử lại 3 lần và có giới hạn', () => {
  const answer = '{"type":"short_answer","answer":"1"}';
  assert.equal(autosaveDelay(answer, null, 0), 1500);
  assert.equal(autosaveDelay(answer, answer, 1), 3000);
  assert.equal(autosaveDelay(answer, answer, 2), 10000);
  assert.equal(autosaveDelay(answer, answer, 3), 30000);
  assert.equal(autosaveDelay(answer, answer, 4), null);
  assert.equal(autosaveDelay('{"type":"short_answer","answer":"12"}', answer, 4), 1500);
});

void test('hết giờ vẫn giữ nháp, được phục hồi sau gia hạn; chỉ xóa khi đã kết thúc', () => {
  const host = browser();
  const key = 'giaokhoa:attempt:example:question:4';
  writeDraft(host, key, { ...blank, answer: 'Đang viết' }, null);
  // readOnly vì hết giờ, nhưng status vẫn in_progress.
  assert.equal(shouldRestoreDraft(false), true);
  assert.equal(shouldClearDraft(false, true, false), false);
  assert.deepEqual(readDraft(host, key)?.draft.answer, 'Đang viết');
  // Gia hạn cho phép tiếp tục sửa từ bản nháp cũ.
  assert.equal(shouldRestoreDraft(false), true);
  assert.equal(shouldClearDraft(false, true, true), false);
  // Nộp bài thành công mới xóa.
  assert.equal(shouldRestoreDraft(true), false);
  assert.equal(shouldClearDraft(true, true, false), true);
});

void test('dữ liệu nháp hỏng hoặc storage bị khóa không làm ứng dụng lỗi', () => {
  const host = browser();
  host.localStorage.setItem('invalid', '{');
  assert.equal(readDraft(host, 'invalid'), null);
  const blocked = {
    get localStorage() {
      throw new Error('Storage disabled');
    },
  };
  assert.equal(readDraft(blocked, 'x'), null);
  assert.equal(writeDraft(blocked, 'x', blank, null), false);
  assert.doesNotThrow(() => clearDraft(blocked, 'x'));
});
