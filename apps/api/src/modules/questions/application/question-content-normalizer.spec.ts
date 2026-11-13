import { describe, expect, it } from 'vitest';
import {
  assertSupportedQtype, normaliseQuestionContent,
  type QuestionContentInput,
} from './question-content-normalizer';

describe('Chuẩn hoá nội dung câu hỏi dùng chung giữa HTTP và nghiệp vụ', () => {
  const answers = (): NonNullable<QuestionContentInput['answers']> => [
    { text: 'A', correct: true },
    { text: 'B', correct: false },
    { text: 'C', correct: false },
    { text: 'D', correct: false },
  ];

  it('câu multichoice hợp lệ có bốn lựa chọn, đúng một đáp án và guidance ở answer key', () => {
    const output = normaliseQuestionContent('multichoice', {
      answers: answers(),
      guidance: 'Giải thích',
    });
    expect(output.answers).toHaveLength(4);
    expect(output.answers.filter((row) => row.isCorrect)).toHaveLength(1);
    expect(output.answerKey.guidance).toBeTruthy();
    expect(output.multichoice?.answerNumbering).toBe('abc');
  });

  it('câu multichoice thiếu lựa chọn hoặc có hai đáp án đúng bị từ chối cùng mã lỗi nghiệp vụ', () => {
    const cases = [
      answers().slice(0, 3),
      answers().map((a, i) => ({ ...a, correct: i <= 1 })),
    ];
    const errors = cases.map((items) => {
      try {
        normaliseQuestionContent('multichoice', { answers: items });
        return 'unexpected-success';
      } catch (error) {
        return (error as { getResponse(): { code?: string } }).getResponse().code;
      }
    });
    expect(errors).toEqual(['question.bad_answer_data', 'question.bad_answer_data']);
  });

  it('essay giới hạn từ ngược và shortanswer liệt kê đáp án sai đều bị chặn', () => {
    expect(() => normaliseQuestionContent('essay', {
      options: { minWordLimit: 100, maxWordLimit: 10 },
    })).toThrow(/minWordLimit/);
    expect(() => normaliseQuestionContent('shortanswer', {
      answers: [{ text: 'Sai', correct: false }],
    })).toThrow(/all accepted answers/);
  });

  it('qtype ngoài bốn dạng được hỗ trợ không thể bỏ qua validation khi gọi nội bộ', () => {
    expect(() => assertSupportedQtype('multiple_response')).toThrow(/not one of/);
  });

  it('truefalse yêu cầu đủ bốn mệnh đề và đáp án theo đúng statementId', () => {
    const statements = [1, 2, 3, 4].map((i) => ({
      type: 'statement' as const,
      attrs: { id: `s${i}` },
      content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: `Mệnh đề ${i}` }] }],
    }));
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Xác định đúng sai' }] },
        { type: 'statementList' as const, content: statements },
      ],
    };
    const input: QuestionContentInput = {
      questionText: doc,
      solution: { answers: [4, 3, 2, 1].map((i) => ({ statementId: `s${i}`, value: i % 2 === 0 })) },
    };
    const normalised = normaliseQuestionContent('truefalse', input);
    expect(normalised.answerKey.solution).toEqual({
      answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value: i % 2 === 0 })),
    });
    expect(() => normaliseQuestionContent('truefalse', {
      ...input,
      solution: { answers: [{ statementId: 's1', value: true }] },
    })).toThrow(/cover exactly/);
  });
});
