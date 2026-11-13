import type {
  QuestionSolution,
  QuizAttemptSummary,
  QuizView,
  RichTextDocument,
} from '@giaokhoa/contracts';


export interface QuizForUser {
  quiz: QuizView;
  myAttempts: QuizAttemptSummary[];
  myGrade: number | null;
  canAttempt: boolean;
  attemptBlockedReason: string | null;
  inProgressAttemptId: string | null;
  effective: {
    timeOpen: string | null;
    timeClose: string | null;
    timeLimitSeconds: number | null;
    attemptsAllowed: number;
    passwordRequired: boolean;
    nextAttemptAt: string | null;
  };
  permissions: { manage: boolean; manageOverrides: boolean; grade: boolean; viewReports: boolean; preview: boolean; attempt: boolean };
}

export interface ExamPinPageData {
  view: QuizForUser;
  slotNames: Record<string, string>;
}

export interface ExamSourceInfo {
  name: string;
  version: number;
  currentVersionId: string;
  status: string;
}

export interface AttemptQuestion {
  slot: number;
  page: number;
  questionAttemptId: string;
  questionId: string;
  qtype: string;
  questionExcerpt: string;
  questionText: RichTextDocument;
  guidance: RichTextDocument | null;
  solution: QuestionSolution | null;
  stimulus: { id: string; content: RichTextDocument } | null;
  answers: { id: string; text: RichTextDocument }[];
  options: Record<string, unknown> | null;
  maxMark: number;
  state: string;
  response: string | null;
  fraction: number | null;
  mark: number | null;
  rightAnswer: string | null;
  feedback: RichTextDocument | null;
  generalFeedback: RichTextDocument | null;
  manualComment: string | null;
}

export interface AttemptView {
  attempt: {
    id: string; quizId: string; userId: string; attemptNumber: number; state: string;
    preview: boolean; timeStart: string; timeFinish: string | null;
    sumGrades: number | null; grade: number | null;
  };
  quiz: QuizView;
  questions: AttemptQuestion[];
  totalMax: number;
  pendingManualCount: number;
  closedDueToTimeLimit: boolean;
  overallFeedback: string | null;
}

export interface RegradeQuestionVersion {
  id: string;
  version: number;
  status: string;
}

export interface ExamPinSettingsPayload {
  name: string;
  intro: string;
  timeOpen: string | null;
  timeClose: string | null;
  timeLimitSeconds: number | null;
  attemptsAllowed: number;
  gradeMethod: string;
  grade: number;
  shuffleAnswers: boolean;
  versionMode: 'pinned' | 'float_latest_ready';
}

export interface ExamPinOverrideFields {
  timeOpen: string | null;
  timeClose: string | null;
  timeLimitSeconds: number | null;
  attempts: number | null;
  password?: string;
  reason?: string;
}
