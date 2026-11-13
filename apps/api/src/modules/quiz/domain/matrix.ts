
export const TF_SCALE_QD764: number[] = [0, 10, 25, 50, 100];

export const TF_SCALE_EVEN: number[] = [0, 25, 50, 75, 100];

export interface MatrixPreset {
  targetFormPercents: Record<string, number>;
  targetLevelPercents: Record<string, number>;
}

export const MATRIX_PRESETS: Record<'cv7991_periodic', MatrixPreset> = {
  cv7991_periodic: {
    targetFormPercents: { multichoice: 30, truefalse: 20, shortanswer: 20, essay: 30 },
    targetLevelPercents: { biet: 40, hieu: 30, van_dung: 30 },
  },
};

export function isValidTfScale(scale: unknown): scale is number[] {
  if (!Array.isArray(scale) || scale.length !== 5) return false;
  for (const v of scale) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return false;
  }
  for (let i = 1; i < scale.length; i++) {
    if (scale[i]! < scale[i - 1]!) return false;
  }
  return scale[4] === 100;
}

export function effectiveTfScale(quizScale: number[] | null | undefined): number[] {
  return quizScale && isValidTfScale(quizScale) ? quizScale : TF_SCALE_QD764;
}

export interface MatrixCellLike {
  cognitiveLevel: string;
  qtype: string;
  questionCount: number;
  cellScore: number;
}

export function matrixWarnings(input: {
  cells: MatrixCellLike[];
  targetFormPercents: Record<string, number> | null;
  targetLevelPercents: Record<string, number> | null;
  totalScore: number;
}): string[] {
  const warnings: string[] = [];
  const totalCellScore = input.cells.reduce((s, c) => s + c.cellScore, 0);
  if (!input.cells.length) {
    warnings.push('Ma trận chưa có ô nào.');
    return warnings;
  }
  if (Math.abs(totalCellScore - input.totalScore) > 0.001) {
    warnings.push(`Tổng điểm các ô (${round1(totalCellScore)}) khác tổng điểm đích của ma trận (${round1(input.totalScore)}).`);
  }
  const compare = (label: string, actual: Map<string, number>, target: Record<string, number> | null) => {
    if (!target) return;
    const keys = new Set([...Object.keys(target), ...actual.keys()]);
    for (const key of keys) {
      const a = actual.get(key) ?? 0;
      const t = target[key] ?? 0;
      if (Math.abs(a - t) > 0.5) {
        warnings.push(`Tỉ lệ điểm theo ${label} "${key}": thực tế ${round1(a)}% so với mục tiêu ${round1(t)}%.`);
      }
    }
  };
  const pctOf = (pick: (c: MatrixCellLike) => string) => {
    const map = new Map<string, number>();
    for (const c of input.cells) {
      const key = pick(c);
      map.set(key, (map.get(key) ?? 0) + (totalCellScore > 0 ? (c.cellScore / totalCellScore) * 100 : 0));
    }
    return map;
  };
  compare('dạng câu', pctOf((c) => c.qtype), input.targetFormPercents);
  compare('mức', pctOf((c) => c.cognitiveLevel), input.targetLevelPercents);
  return warnings;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export type ExamKind = 'regular' | 'periodic' | 'mock';

export interface ExamKindPreset {
  attemptsAllowed: number;
  reviewMarks: number;
  reviewCorrectness: number;
  reviewSpecificFeedback: number;
  reviewGeneralFeedback: number;
  reviewRightAnswer: number;
  reviewOverallFeedback: number;
  lateEntryMinutes: number | null;
  monitorEvents: boolean;
  shuffleAnswers: boolean;
}

const REVIEW_AFTER_SUBMIT = 4368;
const REVIEW_AFTER_CLOSE_ONLY = 16;

export const EXAM_KIND_PRESETS: Record<ExamKind, ExamKindPreset> = {
  regular: {
    attemptsAllowed: 1,
    reviewMarks: REVIEW_AFTER_SUBMIT,
    reviewCorrectness: REVIEW_AFTER_SUBMIT,
    reviewSpecificFeedback: REVIEW_AFTER_SUBMIT,
    reviewGeneralFeedback: REVIEW_AFTER_SUBMIT,
    reviewRightAnswer: REVIEW_AFTER_SUBMIT,
    reviewOverallFeedback: REVIEW_AFTER_SUBMIT,
    lateEntryMinutes: null,
    monitorEvents: false,
    shuffleAnswers: true,
  },
  periodic: {
    attemptsAllowed: 1,
    reviewMarks: REVIEW_AFTER_CLOSE_ONLY,
    reviewCorrectness: REVIEW_AFTER_CLOSE_ONLY,
    reviewSpecificFeedback: REVIEW_AFTER_CLOSE_ONLY,
    reviewGeneralFeedback: REVIEW_AFTER_CLOSE_ONLY,
    reviewRightAnswer: REVIEW_AFTER_CLOSE_ONLY,
    reviewOverallFeedback: REVIEW_AFTER_CLOSE_ONLY,
    lateEntryMinutes: null,
    monitorEvents: true,
    shuffleAnswers: true,
  },
  mock: {
    attemptsAllowed: 1,
    reviewMarks: REVIEW_AFTER_CLOSE_ONLY,
    reviewCorrectness: REVIEW_AFTER_CLOSE_ONLY,
    reviewSpecificFeedback: REVIEW_AFTER_CLOSE_ONLY,
    reviewGeneralFeedback: REVIEW_AFTER_CLOSE_ONLY,
    reviewRightAnswer: REVIEW_AFTER_CLOSE_ONLY,
    reviewOverallFeedback: REVIEW_AFTER_CLOSE_ONLY,
    lateEntryMinutes: 15,
    monitorEvents: true,
    shuffleAnswers: true,
  },
};

export function tfScaleLabel(scale: number[]): string {
  const isQd764 = scale.length === TF_SCALE_QD764.length && scale.every((v, i) => v === TF_SCALE_QD764[i]);
  return isQd764 ? 'thang QĐ 764' : `thang tuỳ chỉnh [${scale.join('/')}]`;
}
