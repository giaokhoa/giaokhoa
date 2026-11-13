
export interface CurriculumLite {
  id: string;
  subjectId: string;
  grade: number;
}
export interface BankLite {
  id: string;
  scope: string;
}
export interface CellLite {
  id: string;
  curriculumNodeId: string;
  cognitiveLevel: string;
  qtype: string;
  questionCount: number;
  cellScore: number;
}
export interface MatrixLite {
  id: string;
  name: string;
  subjectId: string;
  curriculumId: string;
  bankId: string | null;
  status: string;
  isTemplate: boolean;
  version: number;
  presetKind: string;
  levelSet: string;
  totalScore: number;
  cells: CellLite[];
}
export interface AvailabilityLite {
  sufficient: boolean;
  cells: { cellId: string; required: number; available: number; deficit: number }[];
}

export interface SpecificationOutcomeLite {
  outcomeId: string;
  content: string;
  sourceKind: string;
  sourceRef: string | null;
  programContent: string | null;
  derivedContent: string | null;
  position: number | null;
  code: string | null;
}

export interface SpecificationCellLite {
  cellId: string;
  cognitiveLevel: string;
  qtype: string;
  questionCount: number;
  cellScore: number;
  minutes: number | null;
  slotNumbers: number[] | null;
  drawNote: string | null;
}

export interface MatrixSpecificationLite {
  matrix: { id: string; name: string; totalScore: number; levelSet: string };
  subject: { id: string; name: string };
  curriculum: { id: string; grade: number };
  purpose: string;
  topics: {
    topicId: string | null;
    topicTitle: string;
    nodes: {
      nodeId: string;
      nodeTitle: string;
      outcomes: SpecificationOutcomeLite[];
      cells: SpecificationCellLite[];
    }[];
  }[];
  totals: { totalQuestions: number; totalScore: number };
}

export interface MatrixTreeNode {
  id: string;
  title: string;
  outcomes: { id: string; content: string }[];
  children: MatrixTreeNode[];
}
