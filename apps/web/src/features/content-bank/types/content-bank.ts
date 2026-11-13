import type { ContentBankContent } from '@giaokhoa/contracts';


export type LibraryItem = ContentBankContent;

export interface LibrarySpace {
  scope: string;
  spaceId: string | null;
  name: string;
  canReview: boolean;
}

export const RESOURCE_TYPES = ['multimedia_lecture', 'lab_guide', 'simulation', 'question_set', 'reference'] as const;
export const REVIEW_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export const LEVELS = ['primary', 'lower_secondary', 'upper_secondary', 'multi'] as const;
export const SOURCE_KINDS = ['self', 'cited', 'derived'] as const;
export const TARGET_AUDIENCES = ['students', 'teachers', 'both'] as const;
export const LESSON_POSITIONS = ['opening', 'new_knowledge', 'practice', 'application'] as const;

export interface ReviewChecklist {
  contentAccurate: boolean;
  sourceClear: boolean;
  pedagogyAesthetics: boolean;
  mobileReady: boolean;
}

export interface LibraryFilters {
  scope?: string;
  spaceId?: string | null;
  subjectId?: string;
  grade?: number;
  level?: string;
  resourceType?: string;
  reviewStatus?: string;
}

export interface LibraryItemInput {
  name: string;
  resourceType?: string;
  scope?: string;
  spaceId?: string | null;
  subjectId?: string | null;
  grade?: number | null;
  level?: string | null;
  curriculumNodeId?: string | null;
  outcomeIds?: string[] | null;
  questionCategoryId?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  keywords?: string[] | null;
  targetAudience?: string | null;
  lessonPosition?: string | null;
  techFormat?: string | null;
  durationSeconds?: number | null;
  language?: string | null;
  originalAuthor?: string | null;
  sourceKind?: string | null;
  sourceCitation?: string | null;
  license?: string | null;
  derivedFromId?: string | null;
}

export interface QuestionCategoryView {
  id: string;
  name: string;
}

export interface FlatNode {
  id: string;
  title: string;
  kind: string;
  depth: number;
  outcomeIds: string[];
  outcomes: { id: string; content: string }[];
}
