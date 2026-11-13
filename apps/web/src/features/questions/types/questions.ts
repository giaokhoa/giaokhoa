import type { RichTextDocument } from '@giaokhoa/contracts';


export interface BankLite {
  id: string;
  name: string;
  scope: string;
  bankKind: string;
  defaultCategoryId: string | null;
  categoryIds: string[];
  capabilities: {
    use: boolean; add: boolean; moderate: boolean; copy: boolean;
    matrixView?: boolean; matrixManage?: boolean; matrixCopy?: boolean; matrixShare?: boolean; matrixModerate?: boolean;
  };
}

export interface MatrixLite {
  id: string;
  name: string;
  subjectId: string;
  curriculumId: string;
  bankId: string | null;
  status: string;
  isTemplate: boolean;
  derivedFromMatrixId: string | null;
  version: number;
  presetKind: string;
  cells: { id: string }[];
}

export interface MatrixContributionLite {
  id: string;
  matrixId: string;
  matrixName: string | null;
  proposerName: string | null;
  status: string;
  note: string;
  rejectReason: string | null;
}

export interface AttributionLite {
  originalAuthorName: string | null;
  sourceBankName: string | null;
}

export interface PaperSummaryLite {
  id: string;
  bankId: string;
  kind: string;
  status: string;
  name: string;
  examKind: string | null;
  slotCount: number;
  latestVersion: number;
  createdBy: string;
  copyCount: number;
  capabilities: { edit: boolean; copy: boolean; deploy: boolean; moderate: boolean };
}

export interface ExamContributionLite {
  id: string;
  examId: string;
  paperName: string | null;
  status: string;
  proposerId: string;
  mode: string;
  targetExamId: string | null;
  sourceDossierId: string | null;
  dossierExamVersionNumber: number | null;
  dossierMatrixVersion: number | null;
  dossierSpecSnapshot: DossierSpecLite | null;
}

export interface ExamDossierReviewLite {
  level: number;
  reviewerName: string | null;
  decision: string;
  reason: string | null;
}

export interface ExamDossierLite {
  id: string;
  examId: string;
  examName: string | null;
  targetBankId: string;
  proposerName: string | null;
  note: string;
  status: string;
  examVersionNumber: number | null;
  matrixName: string | null;
  matrixVersion: number | null;
  boardApprovalRequired: boolean;
  resultExamId: string | null;
  reviews: ExamDossierReviewLite[];
}

export interface DossierSpecLite {
  totals: { totalQuestions: number; totalScore: number };
  topics: {
    nodes: {
      outcomes: {
        cells: { cognitiveLevel: string; questionCount: number; cellScore: number; slotNumbers: number[] | null }[];
      }[];
    }[];
  }[];
}

export interface DiscoveryItemLite {
  questionId: string;
  excerpt: string;
  qtype: string;
  status: string;
  bankId: string;
  bankName: string;
  bankScope: string;
  authorName: string | null;
  originalAuthorName: string | null;
  useCount: number;
  copyCount: number;
}

export interface ContributionLite {
  id: string;
  questionId: string;
  questionName: string | null;
  proposerName: string | null;
  status: string;
  mode: string;
  note: string;
  nearDuplicateOf: string | null;
}

export type BankKindParam = 'question' | 'matrix' | 'exam';

export interface QuestionCurriculumLinksView {
  questionId: string;
  subjectIds: string[];
  outcomes: { outcomeId: string; cognitiveLevel: string }[];
}

export interface EditorQuestionVersion {
  id: string;
  version: number;
  options?: Record<string, unknown> | null;
}

export interface ContributionReviewVars {
  contributionId: string;
  approve: boolean;
  reason?: string;
}

export interface PinnedQuestionVersion {
  id: string;
  version: number;
  questionText: RichTextDocument;
  stimulusId: string | null;
}
