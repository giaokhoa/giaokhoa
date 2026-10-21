import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import {
  normalizeAttemptDates,
  normalizeDeliveryDates,
  parseAnswer,
  parseQuestionContent,
  textToDocument,
} from '../app/features/attempts/attempt-data.ts';

const id = '01900000-0000-7000-8000-000000000001';
const childIds = Array.from(
  { length: 4 },
  (_, index) => `550e8400-e29b-41d4-a716-44665544000${index}`,
);
const instant = '2026-10-21T09:30:00.000Z';
const attempt = {
  id,
  assignmentId: id,
  userId: id,
  attemptNumber: 1,
  status: 'in_progress',
  startedAt: instant,
  submittedAt: null,
  gradedAt: null,
  responses: [{ position: 7, answer: { type: 'short_answer', answer: '12' }, updatedAt: instant }],
};

void test('chuẩn hóa ngày của lượt làm và từng câu trả lời, giữ nguyên vị trí cùng nội dung', () => {
  const normalized = normalizeAttemptDates(attempt);
  const parsed = attemptsContract.get.responses[200].parse(normalized);
  assert.equal(parsed.startedAt.toISOString(), instant);
  assert.equal(parsed.responses[0].updatedAt.toISOString(), instant);
  assert.equal(parsed.responses[0].position, 7);
  assert.equal(parsed.submittedAt, null);
  assert.equal(parsed.gradedAt, null);
  assert.equal(normalized.responses[0].answer, attempt.responses[0].answer);
  assert.equal(attempt.startedAt, instant);
});

void test('chuẩn hóa riêng ngày danh sách giáo viên và kết quả, không đổi điểm chưa công bố thành 0', () => {
  const { responses: _responses, ...summary } = attempt;
  const list = attemptsContract.listForTeacher.responses[200].parse(
    normalizeAttemptDates([{ ...summary, score: null, feedback: null }]),
  );
  assert.equal(list[0].score, null);
  const result = attemptsContract.result.responses[200].parse(
    normalizeAttemptDates({
      attemptId: id,
      gradedAt: instant,
      score: null,
      feedback: 'Cần trình bày rõ hơn',
    }),
  );
  assert.equal(result.gradedAt.toISOString(), instant);
  assert.equal(result.score, null);
  assert.equal(result.feedback, 'Cần trình bày rõ hơn');
});

void test('từ chối trường ngày bắt buộc sai và không tự sửa chuỗi trong nội dung', () => {
  for (const startedAt of [null, undefined, 42, '', 'không phải ngày']) {
    assert.equal(
      attemptsContract.get.responses[200].safeParse(
        normalizeAttemptDates({ ...attempt, startedAt }),
      ).success,
      false,
    );
  }
  assert.equal(
    attemptsContract.get.responses[200].safeParse(
      normalizeAttemptDates({
        ...attempt,
        responses: [{ ...attempt.responses[0], updatedAt: 'sai' }],
      }),
    ).success,
    false,
  );
  const payload = { ...attempt, feedback: instant };
  assert.equal(normalizeAttemptDates(payload).feedback, instant);
});

void test('chuẩn hóa ngày đề được giao mà không đụng đến câu hỏi hoặc thêm lời giải', () => {
  const question = {
    position: 7,
    question: {
      id,
      version: 1,
      type: 'short_answer',
      content: textToDocument('2026-10-21'),
      stimulus: null,
    },
  };
  const delivery = normalizeDeliveryDates({
    assignmentId: id,
    examRevisionId: id,
    title: 'Bài kiểm tra',
    openAt: instant,
    closeAt: '2026-10-22T09:30:00.000Z',
    maxAttempts: 1,
    questions: [question],
  });
  const parsed = assignmentsContract.delivery.responses[200].parse(delivery);
  assert.ok(parsed.openAt instanceof Date);
  assert.ok(parsed.closeAt instanceof Date);
  assert.equal(delivery.questions[0], question);
  assert.equal('solution' in parsed.questions[0].question, false);
});

void test('nhận đủ năm cấu trúc câu trả lời, gồm tự luận có phần và tài liệu có công thức', () => {
  const document = textToDocument('Dòng đầu\n\nDòng cuối');
  const answers = [
    { type: 'multiple_choice', choiceId: childIds[0] },
    {
      type: 'true_false',
      answers: childIds.map((statementId, index) => ({ statementId, value: index % 2 === 0 })),
    },
    { type: 'short_answer', answer: '-12' },
    { type: 'essay', answer: document },
    {
      type: 'essay',
      answers: childIds.slice(0, 2).map((partId) => ({ partId, content: document })),
    },
    {
      type: 'essay',
      answer: { type: 'doc', content: [{ type: 'blockMath', attrs: { latex: 'x^2' } }] },
    },
  ];
  for (const answer of answers) assert.deepEqual(parseAnswer(answer), answer);
});

void test('từ chối câu thiếu dữ liệu, mệnh đề trùng hoặc thiếu và phần tự luận trùng', () => {
  const trueFalse = childIds.map((statementId) => ({ statementId, value: false }));
  for (const answer of [
    null,
    { type: 'multiple_choice', choiceId: id },
    { type: 'true_false', answers: trueFalse.slice(1) },
    { type: 'true_false', answers: [...trueFalse.slice(1), trueFalse[1]] },
    { type: 'true_false', answers: trueFalse.map(({ statementId }) => ({ statementId })) },
    { type: 'short_answer', answer: '12345' },
    { type: 'short_answer', answer: '1.2' },
    { type: 'essay', answer: textToDocument(' \n ') },
    {
      type: 'essay',
      answers: [1, 2].map(() => ({ partId: childIds[0], content: textToDocument('Bài giải') })),
    },
  ])
    assert.equal(parseAnswer(answer), null);
});

void test('chỉ đọc nội dung câu đúng kiểu và không coi lời giải là câu hỏi', () => {
  assert.equal(parseQuestionContent('multiple_choice', textToDocument('Thiếu phương án')), null);
  assert.equal(parseQuestionContent('short_answer', { solution: { answer: '12' } }), null);
  assert.deepEqual(
    parseQuestionContent('essay', textToDocument('Trình bày cách giải')),
    textToDocument('Trình bày cách giải'),
  );
});
