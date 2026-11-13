import { apiJson } from '#lib/api';
import type { PlanReviewActionName, UsercompReviewActionName } from '../types/learning-plan';
import type {
  CompetencyView,
  FrameworkView,
  PlanDetail,
  PlanView,
  TemplateView,
  UserOption,
  UsercompView,
} from '../types/types';


export function fetchUserLearningPlans(userId: string) {
  return apiJson<PlanView[]>(`/api/v1/competencies/plans/user/${userId}`);
}

export function fetchLearningPlanDetail(planId: string) {
  return apiJson<PlanDetail>(`/api/v1/competencies/plans/${planId}`);
}

export function requestPlanReview(planId: string) {
  return apiJson(`/api/v1/competencies/plans/${planId}/request-review`, { method: 'POST', body: '{}' });
}

export function requestCompetencyReview(usercompId: string, description: string) {
  return apiJson(`/api/v1/competencies/usercomp/${usercompId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({ action: 'evidence', description, sendForReview: true }),
  });
}

export function fetchCompetencyFrameworks() {
  return apiJson<FrameworkView[]>('/api/v1/competencies/frameworks');
}

export function fetchCompetencyTemplates() {
  return apiJson<TemplateView[]>('/api/v1/competencies/templates');
}

export function fetchFrameworkCompetencies(frameworkId: string) {
  return apiJson<CompetencyView[]>(`/api/v1/competencies/frameworks/${frameworkId}/competencies`);
}

export function fetchFrameworkExport(frameworkId: string) {
  return apiJson<unknown>(`/api/v1/competencies/frameworks/${frameworkId}/export`);
}

export async function fetchUserOptions() {
  const res = await apiJson<{ users?: UserOption[] } | UserOption[]>('/api/v1/users?page=1&pageSize=50');
  return Array.isArray(res) ? res : (res.users ?? []);
}

export function fetchUserCompetencies(userId: string) {
  return apiJson<UsercompView[]>(`/api/v1/competencies/usercomp/user/${userId}`);
}

export function createCompetencyFramework(body: {
  shortName: string;
  idNumber?: string;
  description?: string;
  scale: { values: string[]; proficient: number[] };
  visible?: boolean;
}) {
  return apiJson('/api/v1/competencies/frameworks', { method: 'POST', body: JSON.stringify(body) });
}

export function importCompetencyFramework(doc: unknown) {
  return apiJson<FrameworkView>('/api/v1/competencies/frameworks/import', {
    method: 'POST',
    body: JSON.stringify(doc),
  });
}

export function createCompetency(
  frameworkId: string,
  body: { shortName: string; idNumber?: string; description?: string; parentId?: string },
) {
  return apiJson(`/api/v1/competencies/frameworks/${frameworkId}/competencies`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function createLearningPlanTemplate(body: { shortName: string; description?: string; dueDate?: string }) {
  return apiJson<TemplateView>('/api/v1/competencies/templates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function addTemplateCompetency(templateId: string, competencyId: string) {
  return apiJson(`/api/v1/competencies/templates/${templateId}/competencies`, {
    method: 'POST',
    body: JSON.stringify({ competencyId }),
  });
}

export function addTemplateCohort(templateId: string, cohortId: string) {
  return apiJson(`/api/v1/competencies/templates/${templateId}/cohorts`, {
    method: 'POST',
    body: JSON.stringify({ cohortId }),
  });
}

export function createPlansFromTemplate(templateId: string) {
  return apiJson<{ created: number }>(`/api/v1/competencies/templates/${templateId}/create-plans`, {
    method: 'POST',
    body: '{}',
  });
}

export function planReviewAction(planId: string, action: PlanReviewActionName) {
  return apiJson(`/api/v1/competencies/plans/${planId}/${action}`, { method: 'POST', body: '{}' });
}

export function usercompReviewAction(usercompId: string, action: UsercompReviewActionName) {
  return apiJson(`/api/v1/competencies/usercomp/${usercompId}/${action}`, { method: 'POST', body: '{}' });
}
