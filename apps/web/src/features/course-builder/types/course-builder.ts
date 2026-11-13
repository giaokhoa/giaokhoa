import type { Course, CourseContent, CourseGroup, CourseGrouping, GradeItem } from '@giaokhoa/contracts';


export interface BuilderCriteriaView {
  method: number;
  criteria: { id: string; criteriaType: string; moduleInstance: string | null; date: string | null }[];
}

export interface CourseBuilderData {
  course: Course | null;
  content: CourseContent | null;
  gradeItems: GradeItem[];
  criteria: BuilderCriteriaView | null;
  groups: CourseGroup[];
  groupings: CourseGrouping[];
}

export type BuilderBody = Record<string, unknown>;
