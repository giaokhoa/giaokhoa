
export interface PaperSlotView {
  sourceDomain?: 'centre' | 'bank-system';
  position: number;
  section: string;
  questionId: string;
  questionName: string | null;
  qtype: string | null;
  pinnedVersionNumber: number | null;
  latestReadyVersionNumber: number | null;
  hasNewerVersion: boolean;
  maxMark: number;
  clusterId: string | null;
  matrixCellId: string | null;
}

export interface PinViewLite {
  id: string;
  courseId: string;
  courseName: string;
  versionNumber: number;
  name: string | null;
  variantCount: number;
  variantCodes: string[];
  createdAt: string;
}

export interface PaperView {
  paper: {
    id: string;
    bankId: string;
    kind: string;
    status: string;
    latestVersion: number;
    derivedFromPaperId: string | null;
  };
  version: {
    id: string;
    version: number;
    name: string;
    subjectId: string | null;
    grade: number | null;
    examKind: string | null;
    totalScore: number;
    durationMinutes: number | null;
    matrixId: string | null;
    matrixVersion: number | null;
  };
  slots: PaperSlotView[];
  capabilities: { edit: boolean; deploy: boolean };
}

export interface DiscoveryItemLite {
  questionId: string;
  name: string;
  qtype: string;
  bankName: string;
}

export interface CreateExamPaperBody {
  name: string;
  examKind: string | null;
  grade: number | null;
  durationMinutes: number | null;
  totalScore: number;
  slots: import('@giaokhoa/contracts').ExamSlotInput[];
}

export interface UpdateExamPaperMetaBody {
  name: string;
  examKind: string | null;
  grade: number | null;
  durationMinutes: number | null;
  totalScore: number;
}
