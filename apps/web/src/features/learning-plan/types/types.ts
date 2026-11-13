
export interface PlanView {
  id: string;
  name: string;
  status: number;
  templateId: string | null;
}
export interface PlanDetail {
  plan: PlanView;
  competencies: {
    competency: { id: string; shortName: string };
    usercomp: { id: string; grade: number | null; proficiency: boolean | null; status: number } | null;
  }[];
  reviews: { action: string; createdAt: string }[];
}

export interface FrameworkView {
  id: string;
  shortName: string;
  idNumber?: string;
  description?: string;
  scaleConfiguration?: { values?: string[]; proficient?: number[] } | null;
  visible?: boolean;
}
export interface CompetencyView {
  id: string;
  shortName: string;
  idNumber?: string;
  description?: string;
  parentId?: string | null;
  depth?: number;
}
export interface TemplateView {
  id: string;
  shortName: string;
  description?: string;
  dueDate?: string | null;
}
export interface UsercompView {
  id: string;
  userId: string;
  competencyId: string;
  status: number;
  grade: number | null;
  proficiency: boolean | null;
}
export interface UserOption {
  id: string;
  username: string;
}

export const COMPETENCY_INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'];
