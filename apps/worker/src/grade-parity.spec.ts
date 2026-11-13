import { describe, expect, it } from 'vitest';
import {
  FORMULA_FUNCTIONS, GRADE_FORMULA_CORPUS, runGradeCalculatorParityProbe, runGradeFormulaCorpus,
} from '@giaokhoa/grades';

describe('Worker — parity bộ máy công thức điểm (@giaokhoa/grades)', () => {
  it('tập hàm hỗ trợ đủ 9 hàm của bản đầy đủ (bản rút gọn cũ chỉ có 4)', () => {
    expect([...FORMULA_FUNCTIONS]).toEqual(['sum', 'average', 'min', 'max', 'power', 'round', 'mod', 'pi', 'if']);
  });

  it('corpus dùng chung cho outcome đúng kỳ vọng — gồm power/round/mod/pi/if và ca arity', () => {
    expect(runGradeFormulaCorpus()).toEqual(
      GRADE_FORMULA_CORPUS.map((c) => ({ name: c.name, outcome: c.expected })),
    );
  });

  it('grade-calculator dùng chung: ca parity cho 210/300', () => {
    expect(runGradeCalculatorParityProbe()).toBe(210);
  });
});
