import { createHash } from 'node:crypto';

export type SystemQuestionPackage = {
  questionText: unknown;
  generalFeedback: unknown | null;
  stimulusContent: unknown | null;
  answers: Array<{
    answer: unknown;
    isCorrect: boolean;
    feedback: unknown | null;
    sortOrder: number;
  }>;
  answerKey: {
    guidance: unknown | null;
    solution: unknown | null;
  } | null;
  options: Record<string, unknown> | null;
  outcomes: Array<{
    outcomeId: string;
    cognitiveLevel: string;
  }>;
  source?: {
    centreSlug: string; questionId: string; versionId: string; versionNumber: number;
    authorId: string | null; sourceKind: string | null; sourceRef: string | null; license: string | null;
  };
  media?: Array<{ contentHash: string; fileName: string; mimeType: string }>;
};

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJson(item)}`).join(',')}}`;
}

export function checksumPackage(pkg: unknown): string {
  return createHash('sha256').update(canonicalizeJson(pkg), 'utf8').digest('hex');
}

export function verifyPackageChecksum(pkg: SystemQuestionPackage, expectedChecksum: string): boolean {
  return checksumPackage(pkg) === expectedChecksum;
}

export function packageValidationError(qtype: string, pkg: SystemQuestionPackage): string | null {
  const correctCount = pkg.answers.filter((answer) => answer.isCorrect).length;
  if (qtype === 'multichoice') {
    if (pkg.answers.length !== 4) return 'multichoice package must carry exactly 4 answers';
    if (correctCount !== 1) return 'multichoice package must carry exactly 1 correct answer';
    return null;
  }
  if (qtype === 'truefalse') {
    if (pkg.answers.length !== 0) {
      return 'truefalse (TF-A) packages do not carry answer rows; per-statement answers go through answerKey.solution';
    }
    return null;
  }
  if (qtype === 'shortanswer') {
    if (pkg.answers.length < 1) return 'shortanswer package must carry at least 1 accepted answer';
    if (correctCount !== pkg.answers.length) return 'shortanswer package answers must all be accepted answers';
    return null;
  }
  if (qtype === 'essay') {
    if (pkg.answers.length !== 0) return 'essay packages do not carry answer rows';
    return null;
  }
  return `unsupported question type: ${qtype}`;
}
