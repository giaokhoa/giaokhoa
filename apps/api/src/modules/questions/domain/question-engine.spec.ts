import { describe, expect, it } from 'vitest';
import { canTransition, gradeAnswer, truefalseHashAnswers, usageState, DeferredFeedbackBehaviour, type GradingData } from './question-engine';

describe('question engine domain (mô hình giaokhoa — chấm nhị phân theo isCorrect)', () => {
  it('máy trạng thái: notstarted chỉ có thể start; trạng thái đã chấm là trạng thái cuối', () => {
    expect(canTransition('notstarted', 'todo')).toBe(true);
    expect(canTransition('notstarted', 'gradedright')).toBe(false);
    expect(canTransition('todo', 'complete')).toBe(true);
    expect(canTransition('complete', 'gradedright')).toBe(true);
    expect(canTransition('complete', 'needsgrading')).toBe(true);
    expect(canTransition('gradedright', 'todo')).toBe(false);
    expect(canTransition('needsgrading', 'gradedright')).toBe(true);
    expect(canTransition('needsgrading', 'gradedpartial')).toBe(true);
    expect(canTransition('needsgrading', 'gradedwrong')).toBe(true);
    expect(canTransition('needsgrading', 'todo')).toBe(false);
    expect(canTransition('needsgrading', 'needsgrading')).toBe(false);
  });

  it('deferredfeedback: nộp bài ghi complete/incomplete mà không chấm; chấm diễn ra lúc kết thúc', () => {
    const b = new DeferredFeedbackBehaviour();
    expect(b.stateAfterSubmit('true')).toBe('complete');
    expect(b.stateAfterSubmit('')).toBe('incomplete');
    expect(b.stateAfterSubmit(null)).toBe('incomplete');
    const tf: GradingData = {
      answers: [],
      truefalseStatements: [
        { statementId: 's1', value: true },
        { statementId: 's2', value: false },
        { statementId: 's3', value: true },
        { statementId: 's4', value: false },
      ],
    };
    expect(b.gradeAtFinish('truefalse', tf, null)).toBeNull();
  });

  it('truefalse grading (TF-A): chấm từng mệnh đề rồi tra thang Đ–S mặc định QĐ 764 theo số ý đúng', () => {
    const data: GradingData = {
      answers: [],
      truefalseStatements: [
        { statementId: 's1', value: true },
        { statementId: 's2', value: false },
        { statementId: 's3', value: true },
        { statementId: 's4', value: true },
      ],
    };
    const respond = (answers: Record<string, boolean>) => JSON.stringify(answers);
    expect(gradeAnswer('truefalse', data, respond({ s1: false, s2: true, s3: false, s4: false })))
      .toMatchObject({ fraction: 0, state: 'gradedwrong' });
    expect(gradeAnswer('truefalse', data, respond({ s1: true, s2: true, s3: false, s4: false })).fraction).toBe(0.1);
    expect(gradeAnswer('truefalse', data, respond({ s1: true, s2: false, s3: false, s4: false })).fraction).toBe(0.25);
    expect(gradeAnswer('truefalse', data, respond({ s1: true, s2: false, s3: true, s4: false })))
      .toMatchObject({ fraction: 0.5, state: 'gradedpartial' });
    expect(gradeAnswer('truefalse', data, respond({ s1: true, s2: false, s3: true, s4: true })))
      .toMatchObject({ fraction: 1, state: 'gradedright' });
    expect(gradeAnswer('truefalse', data, respond({ s1: true })).fraction).toBe(0.1);
    expect(gradeAnswer('truefalse', data, 'true').fraction).toBe(0);
    expect(gradeAnswer('truefalse', data, null).fraction).toBe(0);
    expect(gradeAnswer('truefalse', data, respond({})).rightAnswer).toBe('Đúng, Sai, Đúng, Đúng');
  });

  it('truefalse grading (TF-A): thang của lần ghim thắng thang mặc định — thang không nằm trong câu hỏi', () => {
    const statements = [
      { statementId: 's1', value: true },
      { statementId: 's2', value: false },
      { statementId: 's3', value: true },
      { statementId: 's4', value: true },
    ];
    const twoCorrect = JSON.stringify({ s1: true, s2: false, s3: false, s4: false });
    expect(gradeAnswer('truefalse', { answers: [], truefalseStatements: statements, tfScale: [0, 25, 50, 75, 100] }, twoCorrect).fraction).toBe(0.5);
    expect(gradeAnswer('truefalse', { answers: [], truefalseStatements: statements }, twoCorrect).fraction).toBe(0.25);
    expect(gradeAnswer('truefalse', { answers: [], truefalseStatements: statements, tfScale: [0, 50, 100] }, twoCorrect).fraction).toBe(0.25);
  });

  it('shortanswer grading: khớp CHÍNH XÁC sau chuẩn hoá — lệch một ký tự là 0, dấu * không còn là wildcard (D-2)', () => {
    const data: GradingData = {
      answers: [
        { id: '1', text: 'Hà Nội', isCorrect: true },
        { id: '2', text: 'Ha Noi', isCorrect: true },
      ],
      shortanswer: { useCase: false },
    };
    expect(gradeAnswer('shortanswer', data, 'hà nội')).toMatchObject({ fraction: 1, state: 'gradedright' });
    expect(gradeAnswer('shortanswer', data, '   Hà Nội   ').fraction).toBe(1);
    expect(gradeAnswer('shortanswer', data, 'Ha Noi').fraction).toBe(1);
    expect(gradeAnswer('shortanswer', data, 'Hà Nộ')).toMatchObject({ fraction: 0, state: 'gradedwrong' });
    expect(gradeAnswer('shortanswer', data, 'Hà Nội!').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', data, 'Hà *').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', data, '*').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', data, 'Ha Noi').rightAnswer).toBe('Hà Nội');
  });

  it('shortanswer grading: useCase bật thì hoa/thường phải khớp đúng', () => {
    const sensitive: GradingData = {
      answers: [{ id: '1', text: 'Paris', isCorrect: true }],
      shortanswer: { useCase: true },
    };
    expect(gradeAnswer('shortanswer', sensitive, 'paris').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', sensitive, 'Paris').fraction).toBe(1);
    expect(gradeAnswer('shortanswer', sensitive, 'Paris').rightAnswer).toBe('Paris');
  });

  it('shortanswer grading: dòng đáp án không được chấp nhận (isCorrect = false) không bao giờ ăn điểm', () => {
    const data: GradingData = {
      answers: [
        { id: '1', text: 'frog', isCorrect: false },
        { id: '2', text: 'toad', isCorrect: true },
      ],
      shortanswer: { useCase: false },
    };
    expect(gradeAnswer('shortanswer', data, 'frog').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', data, 'toad').fraction).toBe(1);
  });

  it('shortanswer numeric mode (issue #30 point 6.3.3): off = khớp chính xác thường; on = length/charset gate before matching', () => {
    const base: GradingData = {
      answers: [{ id: '1', text: '1234', isCorrect: true }, { id: '2', text: '-5,5', isCorrect: true }],
      shortanswer: { useCase: false },
    };
    expect(gradeAnswer('shortanswer', base, '1234').fraction).toBe(1);
    const on: GradingData = { ...base, shortanswer: { useCase: false, numericAnswer: true } };
    expect(gradeAnswer('shortanswer', on, '1234').fraction).toBe(1);
    expect(gradeAnswer('shortanswer', on, '12345').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', on, '-5,5').fraction).toBe(1);
    expect(gradeAnswer('shortanswer', on, '12a4').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', on, '').fraction).toBe(0);
    const noSign: GradingData = { ...base, shortanswer: { useCase: false, numericAnswer: true, numericAllowSign: false } };
    expect(gradeAnswer('shortanswer', noSign, '-5,5').fraction).toBe(0);
    const longer: GradingData = { ...base, shortanswer: { useCase: false, numericAnswer: true, numericMaxLength: 6 } };
    expect(gradeAnswer('shortanswer', longer, '12345').fraction).toBe(0);
    expect(gradeAnswer('shortanswer', { answers: [{ id: '1', text: '12345', isCorrect: true }], shortanswer: { useCase: false, numericAnswer: true, numericMaxLength: 6 } }, '12345').fraction).toBe(1);
  });

  it('multichoice grading: chọn đúng một đáp án và đó là đáp án đúng duy nhất → 1; mọi trường hợp khác → 0', () => {
    const data: GradingData = {
      answers: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B', isCorrect: false },
        { id: 'c', text: 'C', isCorrect: false },
        { id: 'd', text: 'D', isCorrect: false },
      ],
    };
    expect(gradeAnswer('multichoice', data, 'a')).toMatchObject({ fraction: 1, state: 'gradedright' });
    expect(gradeAnswer('multichoice', data, 'b')).toMatchObject({ fraction: 0, state: 'gradedwrong' });
    expect(gradeAnswer('multichoice', data, 'a,b')).toMatchObject({ fraction: 0, state: 'gradedwrong' });
    expect(gradeAnswer('multichoice', data, 'missing-id')).toMatchObject({ fraction: 0, state: 'gradedwrong' });
    expect(gradeAnswer('multichoice', data, null)).toMatchObject({ fraction: 0, state: 'gradedwrong' });
    expect(gradeAnswer('multichoice', data, 'a').rightAnswer).toBe('A');
  });

  it('essay không bao giờ tự chấm: nó rơi vào needsgrading với fraction null', () => {
    const outcome = gradeAnswer('essay', { answers: [] }, 'A long student essay.');
    expect(outcome.state).toBe('needsgrading');
    expect(outcome.fraction).toBeNull();
  });

  it('trạng thái usage cuộn lên: chỉ finished khi mọi lượt làm đều finished (needsgrading tính là finished)', () => {
    expect(usageState(['notstarted', 'notstarted'])).toBe('notstarted');
    expect(usageState(['todo', 'gradedright'])).toBe('inprogress');
    expect(usageState(['gradedright', 'gaveup'])).toBe('finished');
    expect(usageState(['gradedright', 'needsgrading'])).toBe('finished');
  });

  it('truefalseHashAnswers (#316): ghép text từng mệnh đề với giá trị Đ/S của solution theo statementId', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Thân câu' }] },
        {
          type: 'statementList',
          content: [1, 2, 3, 4].map((i) => ({
            type: 'statement',
            attrs: { id: `s${i}` },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `Ý ${i}` }] }],
          })),
        },
      ],
    };
    const allTrue = { answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value: true })) };
    const oneFlipped = { answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value: i !== 4 })) };
    expect(truefalseHashAnswers(doc, allTrue)).toEqual([
      { textPlain: 'Ý 1', isCorrect: true },
      { textPlain: 'Ý 2', isCorrect: true },
      { textPlain: 'Ý 3', isCorrect: true },
      { textPlain: 'Ý 4', isCorrect: true },
    ]);
    expect(truefalseHashAnswers(doc, oneFlipped)).not.toEqual(truefalseHashAnswers(doc, allTrue));
    expect(truefalseHashAnswers(doc, oneFlipped)[3]).toEqual({ textPlain: 'Ý 4', isCorrect: false });
    expect(truefalseHashAnswers(doc, null)).toEqual([]);
    expect(truefalseHashAnswers({ type: 'doc', content: [] }, allTrue)).toEqual([]);
    expect(truefalseHashAnswers(null, allTrue)).toEqual([]);
  });
});
