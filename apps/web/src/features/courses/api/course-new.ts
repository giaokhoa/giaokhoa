import type { Course, CourseCategoryTreeNode } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';


async function probeList<T>(path: string): Promise<T[]> {
  try {
    return await apiJson<T[]>(path);
  } catch {
    return [];
  }
}

export function fetchWizardCategoryTree() {
  return probeList<CourseCategoryTreeNode>('/api/v1/courses/categories/tree');
}

export function fetchWizardCourseList() {
  return probeList<Course>('/api/v1/courses');
}

export function fetchWizardCourseTemplates() {
  return probeList<Course>('/api/v1/courses/templates');
}

export function createCourse(body: Record<string, unknown>) {
  return apiJson<Course>('/api/v1/courses', { method: 'POST', body: JSON.stringify(body) });
}

export function duplicateCourse(input: { fromId: string; body: Record<string, unknown> }) {
  return apiJson<Course>(`/api/v1/courses/${input.fromId}/copy`, {
    method: 'POST',
    body: JSON.stringify(input.body),
  });
}

export function applyCurriculumFrame(input: {
  courseId: string;
  curriculumId: string;
  nodeIds: string[];
}) {
  return apiJson(`/api/v1/courses/${input.courseId}/curriculum-frame`, {
    method: 'POST',
    body: JSON.stringify({ curriculumId: input.curriculumId, nodeIds: input.nodeIds }),
  });
}
