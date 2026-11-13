
export const MATRIX_CONTENT_SIGNATURE_UNIQUE_CONSTRAINT = 'exam_matrices_bank_content_signature_unique';

export interface MatrixContentSignatureCell {
  curriculumNodeId: string;
  cognitiveLevel: string;
  qtype: string;
  questionCount: number;
  cellScore: number;
}

export interface MatrixContentSignatureInput {
  name: string;
  subjectId: string;
  curriculumId: string;
  levelSet: string;
  totalScore: number;
  scopeNote: string | null;
  scopeNodeIds: string[] | null;
  cells: MatrixContentSignatureCell[];
}

export function matrixContentSignature(input: MatrixContentSignatureInput): string {
  const norm = (n: number) => Math.round(n * 10000) / 10000;
  return JSON.stringify({
    name: input.name, subjectId: input.subjectId, curriculumId: input.curriculumId,
    levelSet: input.levelSet, totalScore: norm(input.totalScore), scopeNote: input.scopeNote,
    scopeNodeIds: [...(input.scopeNodeIds ?? [])].sort(),
    cells: input.cells
      .map((c) => [c.curriculumNodeId, c.cognitiveLevel, c.qtype, c.questionCount, norm(c.cellScore)].join('|'))
      .sort(),
  });
}

export function isMatrixContentSignatureConflict(err: unknown): boolean {
  let e: unknown = err;
  while (e !== null && typeof e === 'object') {
    const candidate = e as { code?: unknown; constraint?: unknown; message?: unknown };
    if (candidate.code === '23505'
      && (candidate.constraint === MATRIX_CONTENT_SIGNATURE_UNIQUE_CONSTRAINT
        || (typeof candidate.message === 'string' && candidate.message.includes(MATRIX_CONTENT_SIGNATURE_UNIQUE_CONSTRAINT)))) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
