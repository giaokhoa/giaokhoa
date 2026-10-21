import assert from 'node:assert/strict';
import { test } from 'node:test';
import { examsContract } from '@giaokhoa/shared/http/exams';
import { normalizeExamDates, parseRevisionInput } from '../app/features/exams/data.ts';

const firstId = '01900000-0000-7000-8000-000000000001';
const secondId = '01900000-0000-7000-8000-000000000002';

void test('đọc nhiều dòng, bỏ dòng trống và giữ thứ tự câu hỏi', () => {
  assert.deepEqual(parseRevisionInput(` ${secondId}, 2\r\n\r\n${firstId},1\n`), {
    success: true,
    data: {
      questions: [
        { questionId: secondId, version: 2 },
        { questionId: firstId, version: 1 },
      ],
    },
  });
});

void test('từ chối dữ liệu rỗng, sai định dạng, sai UUID v7 và sai số phiên bản', () => {
  for (const input of [
    null,
    '',
    ' \n ',
    `${firstId}`,
    `${firstId},1,2`,
    `${firstId},`,
    'abc,1',
    '550e8400-e29b-41d4-a716-446655440000,1',
    `${firstId},0`,
    `${firstId},-1`,
    `${firstId},1.5`,
    `${firstId},1e2`,
    `${firstId},0x10`,
    `${firstId},Infinity`,
    `${firstId},9007199254740992`,
  ]) {
    assert.equal(parseRevisionInput(input).success, false, String(input));
  }
  assert.match(parseRevisionInput(`\n${firstId},1\nabc,2`).error, /Dòng 3/);
});

void test('từ chối lặp câu hỏi dù khác phiên bản hoặc khác chữ hoa chữ thường', () => {
  const mixedId = '019abcde-0000-7000-8000-000000000001';
  assert.equal(parseRevisionInput(`${firstId},1\n${firstId},2`).success, false);
  assert.equal(parseRevisionInput(`${mixedId},1\n${mixedId.toUpperCase()},2`).success, false);
});

void test('chấp nhận 100 câu và từ chối vượt giới hạn hợp đồng', () => {
  const lines = Array.from(
    { length: 101 },
    (_, index) => `01900000-0000-7000-8000-${String(index).padStart(12, '0')},1`,
  );
  assert.equal(parseRevisionInput(lines.slice(0, 100).join('\n')).success, true);
  assert.equal(parseRevisionInput(lines.join('\n')).success, false);
});

const exam = {
  id: firstId,
  title: 'Đề kiểm tra',
  createdByUserId: secondId,
  createdAt: '2026-10-21T12:00:00.000Z',
  updatedAt: '2026-10-21T13:00:00.000Z',
};

void test('chuẩn hoá đúng ngày của đề và danh sách trước khi kiểm tra hợp đồng', () => {
  const result = examsContract.list.responses[200].parse(normalizeExamDates([exam]));
  assert.equal(result[0].createdAt.toISOString(), exam.createdAt);
  assert.equal(result[0].updatedAt.toISOString(), exam.updatedAt);
  assert.equal(typeof exam.createdAt, 'string');
  for (const createdAt of [null, undefined, 'không phải ngày', 42]) {
    assert.equal(
      examsContract.get.responses[200].safeParse(normalizeExamDates({ ...exam, createdAt }))
        .success,
      false,
    );
  }
});

void test('chuẩn hoá ngày phiên bản mà không đổi nội dung câu hỏi trong bản chụp', () => {
  const question = { content: { createdAt: '2026-10-21T12:00:00.000Z', text: '2026-10-21' } };
  const snapshot = normalizeExamDates({
    id: firstId,
    revision: 1,
    title: 'Đề kiểm tra',
    createdAt: exam.createdAt,
    questions: [{ position: 1, question }],
  });
  assert.ok(snapshot.createdAt instanceof Date);
  assert.equal(snapshot.questions[0].question, question);
  const { questions: _questions, ...summary } = snapshot;
  assert.equal(examsContract.listRevisions.responses[200].safeParse([summary]).success, true);
});
