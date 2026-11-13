
export interface LearningOutcomeDocNode {
  type: string;
  text?: string;
  marks?: unknown[];
  content?: LearningOutcomeDocNode[];
}

export interface LearningOutcomeDoc {
  type: 'doc';
  content?: LearningOutcomeDocNode[];
}

export interface ExamVariant {
  code: string;
  seed: number;
}

export type SpaceRegistrySnapshot = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  databaseName: string;
  storageMode: string;
  connectionRoleRef: string;
  secretRef: string | null;
  schemaVersion: string | null;
  plan: string | null;
};

export type SchemaMigrationStep = {
  name: string;
  status: string;
  detail?: string;
};

export interface ExamQuestionSnapshot {
  sourceDomain: 'centre' | 'bank-system';
  questionId: string;
  versionId: string;
  versionNumber: number;
  qtype: string;
  defaultMark: number;
  checksum: string;
  package: import('@giaokhoa/contracts').SystemBankPackage;
  answerIds: string[];
}

export type { SystemMaterialPackage } from '@giaokhoa/contracts';
