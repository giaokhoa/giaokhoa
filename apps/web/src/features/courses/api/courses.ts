import type { Course, CourseCategoryTreeNode } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';


export function fetchCourseCategoryTree() {
  return apiJson<CourseCategoryTreeNode[]>('/api/v1/courses/categories/tree');
}

export function fetchCourses() {
  return apiJson<Course[]>('/api/v1/courses');
}

export function fetchCourseMyProgress(courseId: string) {
  return apiJson<{ percent: number | null }>(`/api/v1/courses/${courseId}/progress/me`);
}

export function createCourseCategory(body: { name: string; parent?: string }) {
  return apiJson('/api/v1/courses/categories', { method: 'POST', body: JSON.stringify(body) });
}

export function renameCourseCategory(input: { categoryId: string; name: string }) {
  return apiJson(`/api/v1/courses/categories/${input.categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: input.name }),
  });
}

export function deleteCourseCategory(categoryId: string) {
  return apiJson(`/api/v1/courses/categories/${categoryId}`, { method: 'DELETE' });
}
