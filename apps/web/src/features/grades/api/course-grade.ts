import { apiJson } from '#lib/api';
import type { GradeHistoryView } from '../types/course-grade';


export function fetchGradeItemHistory(itemId: string, userId: string) {
  return apiJson<GradeHistoryView[]>(`/api/v1/grade-items/${itemId}/users/${userId}/history`);
}

export function submitGrade(vars: {
  gradeItemId: string;
  userId: string;
  rawGrade: number | null;
  feedback?: string;
}) {
  return apiJson(`/api/v1/grade-items/${vars.gradeItemId}/grades`, {
    method: 'POST',
    body: JSON.stringify({
      userId: vars.userId,
      rawGrade: vars.rawGrade,
      ...(vars.feedback ? { feedback: vars.feedback } : {}),
    }),
  });
}

export function createGradeItem(courseId: string, vars: { itemName: string; gradeMax: number }) {
  return apiJson(`/api/v1/courses/${courseId}/grade-items`, {
    method: 'POST',
    body: JSON.stringify(vars),
  });
}

export function updateGradeItem(vars: { itemId: string; itemName: string; gradeMax: number }) {
  return apiJson(`/api/v1/grade-items/${vars.itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ itemName: vars.itemName, gradeMax: vars.gradeMax }),
  });
}

export function deleteGradeItem(itemId: string) {
  return apiJson(`/api/v1/grade-items/${itemId}`, { method: 'DELETE' });
}

export function setGradePostingPolicy(vars: { itemId: string; policy: 'auto' | 'manual' }) {
  return apiJson(`/api/v1/grade-items/${vars.itemId}/posting-policy`, {
    method: 'PUT',
    body: JSON.stringify({ policy: vars.policy }),
  });
}

export function setGradeItemPublished(vars: { itemId: string; published: boolean }) {
  return apiJson(`/api/v1/grade-items/${vars.itemId}/${vars.published ? 'publish' : 'unpublish'}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
