export const TEMPLATE_WIDTH = 1240;
export const TEMPLATE_HEIGHT = 1754;
export const PX_PER_PT = TEMPLATE_WIDTH / 595.28;

export const FIDUCIAL_SIZE = 40;
export const FIDUCIAL_CENTERS: readonly { x: number; y: number }[] = [
  { x: 68, y: 68 },
  { x: TEMPLATE_WIDTH - 68, y: 68 },
  { x: 68, y: TEMPLATE_HEIGHT - 68 },
  { x: TEMPLATE_WIDTH - 68, y: TEMPLATE_HEIGHT - 68 },
];

export const QR_RECT = { x: TEMPLATE_WIDTH - 64 - 240, y: 100, size: 240 };

export const CODE_DIGITS = 4;
export const SBD_DIGITS = 8;
export const CODE_ROWS = 10;
export const CODE_ORIGIN = { x: 420, y: 330 };
export const CODE_COL_STEP = 46;
export const CODE_ROW_STEP = 31;
export const CODE_BUBBLE_R = 12;

export const VARIANT_DIGITS = 4;
export const VARIANT_ORIGIN = { x: 150, y: 372 };
export const VARIANT_WRITE_BOX = { top: 330, width: 38, height: 28 };

export const STUDENT_CHECK_WEIGHTS = [3, 9, 7] as const;

export function studentCodeForIndex(index: number): string {
  if (index < 0 || index > 998) throw new Error(`student index out of range: ${index}`);
  const n = index + 1;
  const d = [Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
  const check = (d[0]! * STUDENT_CHECK_WEIGHTS[0] + d[1]! * STUDENT_CHECK_WEIGHTS[1] + d[2]! * STUDENT_CHECK_WEIGHTS[2]) % 10;
  return `${d[0]}${d[1]}${d[2]}${check}`;
}

export function studentCodeChecksumOk(code: string): boolean {
  if (!/^\d{4}$/.test(code)) return false;
  const d = code.split('').map((c) => Number(c));
  return (d[0]! * STUDENT_CHECK_WEIGHTS[0] + d[1]! * STUDENT_CHECK_WEIGHTS[1] + d[2]! * STUDENT_CHECK_WEIGHTS[2]) % 10 === d[3];
}

export function studentIndexForCode(code: string): number | null {
  if (!studentCodeChecksumOk(code)) return null;
  const n = Number(code.slice(0, 3));
  return n >= 1 ? n - 1 : null;
}

export const SBD_CHECK_WEIGHTS = [3, 9, 7, 9, 1, 3, 7] as const;

export function sbdCodeForIndex(index: number): string {
  if (index < 0 || index > 9_999_998) throw new Error(`sbd index out of range: ${index}`);
  const body = String(index + 1).padStart(7, '0');
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(body[i]) * SBD_CHECK_WEIGHTS[i]!;
  return `${body}${sum % 10}`;
}

export function sbdCodeChecksumOk(code: string): boolean {
  if (!/^\d{8}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(code[i]) * SBD_CHECK_WEIGHTS[i]!;
  return sum % 10 === Number(code[7]);
}

export function sbdIndexForCode(code: string): number | null {
  if (!sbdCodeChecksumOk(code)) return null;
  const n = Number(code.slice(0, 7));
  return n >= 1 ? n - 1 : null;
}

export function codeForIndex(index: number, digits: number): string {
  return digits === SBD_DIGITS ? sbdCodeForIndex(index) : studentCodeForIndex(index);
}

export function codeChecksumOk(code: string): boolean {
  if (code.length === SBD_DIGITS) return sbdCodeChecksumOk(code);
  if (code.length === CODE_DIGITS) return studentCodeChecksumOk(code);
  return false;
}

export function indexForCode(code: string): number | null {
  if (code.length === SBD_DIGITS) return sbdIndexForCode(code);
  if (code.length === CODE_DIGITS) return studentIndexForCode(code);
  return null;
}

export const ANSWER_TOP = 672;
export const ANSWER_ROW_H = 36;
export const ANSWER_ROWS_PER_COLUMN = 30;
export const MAX_SHEET_QUESTIONS = 60;
export const BUBBLE_R = 13;
export const BUBBLE_STEP = 42;
export const MAX_OPTIONS = 5;
export const MAX_BUBBLES_PER_ROW = 8;

export interface AnswerRowGeometry {
  slot: number;
  centers: { x: number; y: number }[];
  labelX: number;
  labelY: number;
  column: number;
}

export interface CodeCellGeometry {
  digitIndex: number;
  value: number;
  x: number;
  y: number;
}

export interface SheetGeometry {
  questionCount: number;
  columns: 1 | 2;
  rows: AnswerRowGeometry[];
  codeDigits: number;
  codeCells: CodeCellGeometry[];
  variantCodeCells: CodeCellGeometry[];
}

export interface SheetRegion { x: number; y: number; w: number; h: number }
export const NAME_REGION: SheetRegion = { x: 56, y: 148, w: 740, h: 104 };
export const STUDENT_CODE_REGION: SheetRegion = { x: 392, y: 296, w: 400, h: 356 };
export const VARIANT_CODE_REGION: SheetRegion = { x: 100, y: 296, w: 224, h: 368 };

function columnOriginX(column: number, columns: 1 | 2): number {
  if (columns === 1) return 72;
  return column === 0 ? 72 : 660;
}

export function computeSheetGeometry(optionCounts: readonly number[], codeDigits: number = CODE_DIGITS): SheetGeometry {
  if (codeDigits !== CODE_DIGITS && codeDigits !== SBD_DIGITS) {
    throw new Error(`code digits out of range: ${codeDigits}`);
  }
  const questionCount = optionCounts.length;
  if (questionCount === 0) throw new Error('sheet needs at least one question');
  if (questionCount > MAX_SHEET_QUESTIONS) throw new Error(`sheet supports at most ${MAX_SHEET_QUESTIONS} questions`);
  for (const n of optionCounts) {
    if (n < 2 || n > MAX_BUBBLES_PER_ROW) throw new Error(`option count out of range: ${n}`);
  }
  const columns: 1 | 2 = questionCount > ANSWER_ROWS_PER_COLUMN ? 2 : 1;
  const rows: AnswerRowGeometry[] = optionCounts.map((count, i) => {
    const column = columns === 1 ? 0 : (i < ANSWER_ROWS_PER_COLUMN ? 0 : 1);
    const rowInColumn = columns === 1 ? i : (i < ANSWER_ROWS_PER_COLUMN ? i : i - ANSWER_ROWS_PER_COLUMN);
    const y = ANSWER_TOP + rowInColumn * ANSWER_ROW_H + ANSWER_ROW_H / 2;
    const originX = columnOriginX(column, columns);
    const centers = Array.from({ length: count }, (_, k) => ({ x: originX + 52 + k * BUBBLE_STEP + BUBBLE_R, y }));
    return { slot: i + 1, centers, labelX: originX, labelY: y, column };
  });
  const codeCells: CodeCellGeometry[] = [];
  for (let digitIndex = 0; digitIndex < codeDigits; digitIndex++) {
    for (let value = 0; value < CODE_ROWS; value++) {
      codeCells.push({
        digitIndex, value,
        x: CODE_ORIGIN.x + digitIndex * CODE_COL_STEP,
        y: CODE_ORIGIN.y + value * CODE_ROW_STEP,
      });
    }
  }
  const variantCodeCells: CodeCellGeometry[] = [];
  for (let digitIndex = 0; digitIndex < VARIANT_DIGITS; digitIndex++) {
    for (let value = 0; value < CODE_ROWS; value++) {
      variantCodeCells.push({
        digitIndex, value,
        x: VARIANT_ORIGIN.x + digitIndex * CODE_COL_STEP,
        y: VARIANT_ORIGIN.y + value * CODE_ROW_STEP,
      });
    }
  }
  return { questionCount, columns, rows, codeDigits, codeCells, variantCodeCells };
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
