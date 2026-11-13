import { calculateCategory } from './grade-calculator.js';
import { GradeFormulaError, calculateFromFormula } from './grade-formula.js';

export type GradeFormulaCorpusOutcome = number | null | `error:${string}`;

export interface GradeFormulaCorpusCase {
  name: string;
  formula: string;
  grades: Record<string, number | null>;
  expected: GradeFormulaCorpusOutcome;
}

export const GRADE_FORMULA_CORPUS_GRADES: Record<string, number | null> = {
  a: 80,
  b: 60,
  c: 100,
  empty: null,
};

const G = GRADE_FORMULA_CORPUS_GRADES;

export const GRADE_FORMULA_CORPUS: readonly GradeFormulaCorpusCase[] = [
  { name: 'sum cơ bản', formula: '=sum([[a]],[[b]])', grades: G, expected: 140 },
  { name: 'sum có trọng số (ví dụ MoodleDocs)', formula: '=sum([[a]]*0.3,[[b]]*0.6,[[c]]*0.1)', grades: G, expected: 70 },
  { name: 'average', formula: '=average([[a]],[[b]],[[c]])', grades: G, expected: 80 },
  { name: 'min', formula: '=min([[a]],[[b]],[[c]])', grades: G, expected: 60 },
  { name: 'max với hằng số', formula: '=max([[a]],[[b]],100)', grades: G, expected: 100 },
  { name: 'power', formula: '=power([[a]],2)', grades: G, expected: 6400 },
  { name: 'power NaN (cơ số âm, mũ phân số) → null', formula: '=power(-1,0.5)', grades: G, expected: null },
  { name: 'round nửa ra xa số 0', formula: '=round(2.5)', grades: G, expected: 3 },
  { name: 'round âm', formula: '=round(-2.5)', grades: G, expected: -3 },
  { name: 'round 2 chữ số thập phân', formula: '=round([[a]]/3,2)', grades: G, expected: 26.67 },
  { name: 'mod phần dư thập phân', formula: '=mod(10.5,3)', grades: G, expected: 1.5 },
  { name: 'mod chia 0 → null', formula: '=mod([[a]],0)', grades: G, expected: null },
  { name: 'pi()', formula: '=pi()', grades: G, expected: 3.141592654 },
  { name: 'pi trần trong biểu thức', formula: '=2*pi', grades: G, expected: 6.283185307 },
  { name: 'if nhánh đúng kèm so sánh (ví dụ 4 MoodleDocs)', formula: '=if([[a]]>=50, [[a]]+[[b]], 0)', grades: G, expected: 140 },
  { name: 'if nhánh sai', formula: '=if(0, [[a]], [[b]])', grades: G, expected: 60 },
  { name: 'if điều kiện trống → null', formula: '=if([[empty]], 1, 0)', grades: G, expected: null },
  { name: 'if lười: nhánh không chọn trống không ảnh hưởng', formula: '=if(1, [[a]], [[empty]])', grades: G, expected: 80 },
  { name: 'so sánh > cho 1', formula: '=[[a]]>50', grades: G, expected: 1 },
  { name: 'so sánh != cho 1', formula: '=[[a]]!=[[b]]', grades: G, expected: 1 },
  { name: 'chia 0 → null', formula: '=[[a]]/0', grades: G, expected: null },
  { name: 'hàm bỏ qua đối số trống', formula: '=sum([[empty]],[[a]])', grades: G, expected: 80 },
  { name: 'phép hai ngôi với toán hạng trống → null', formula: '=[[empty]]+[[a]]', grades: G, expected: null },
  { name: 'lồng average(sum(...))', formula: '=average(sum([[a]],[[b]]), [[c]])', grades: G, expected: 120 },
  { name: 'lồng sum(if(power), round)', formula: '=sum(if([[a]]>50, power(2,3), 0), round(9.6))', grades: G, expected: 18 },
  { name: 'lồng max(power, mod, round(pi()))', formula: '=max(power(2,3), mod(17,5), round(pi()))', grades: G, expected: 8 },
  { name: 'arity: power thiếu mũ', formula: '=power(1)', grades: G, expected: 'error:syntax' },
  { name: 'arity: power thừa đối số', formula: '=power(1,2,3)', grades: G, expected: 'error:syntax' },
  { name: 'arity: if thiếu nhánh', formula: '=if(1,2)', grades: G, expected: 'error:syntax' },
  { name: 'arity: mod thiếu mẫu số', formula: '=mod(1)', grades: G, expected: 'error:syntax' },
  { name: 'arity: pi có đối số', formula: '=pi(1)', grades: G, expected: 'error:syntax' },
  { name: 'arity: round rỗng', formula: '=round()', grades: G, expected: 'error:syntax' },
  { name: 'arity: sum rỗng', formula: '=sum()', grades: G, expected: 'error:syntax' },
  { name: 'hàm không hỗ trợ (sqrt)', formula: '=sqrt(4)', grades: G, expected: 'error:unknown_function' },
  { name: 'chuỗi so sánh bị cấm', formula: '=1<2<3', grades: G, expected: 'error:syntax' },
];

function normalize(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 1e9) / 1e9;
}

export function runGradeFormulaCorpus(): { name: string; outcome: GradeFormulaCorpusOutcome }[] {
  return GRADE_FORMULA_CORPUS.map((c) => {
    try {
      const value = calculateFromFormula(c.formula, (idNumber) => c.grades[idNumber] ?? null);
      return { name: c.name, outcome: normalize(value) };
    } catch (e) {
      if (e instanceof GradeFormulaError) return { name: c.name, outcome: `error:${e.reason}` as const };
      throw e;
    }
  });
}

export function runGradeCalculatorParityProbe(): number | null {
  const calcValue = calculateFromFormula('=average([[a]],[[b]])', (id) => (id === 'a' ? 80 : id === 'b' ? 60 : null))!;
  const result = calculateCategory({
    aggregation: 'natural',
    gradeMin: 0,
    gradeMax: 100,
    items: [
      { itemId: 'a', gradeMin: 0, gradeMax: 100, grade: 80 },
      { itemId: 'b', gradeMin: 0, gradeMax: 100, grade: 60 },
      { itemId: 'calc', gradeMin: 0, gradeMax: 100, grade: calcValue },
    ],
  });
  return result.finalGrade === null ? null : Math.round(result.finalGrade * 1e9) / 1e9;
}
