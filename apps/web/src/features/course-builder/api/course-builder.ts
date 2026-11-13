import type { Course, CourseContent, CourseGroup, CourseGrouping, GradeItem } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { BuilderBody, BuilderCriteriaView, CourseBuilderData } from '../types/course-builder';


async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export async function fetchCourseBuilder(courseId: string): Promise<CourseBuilderData> {
  const [course, content, gradeItems, criteria, groups, groupings] = await Promise.all([
    probe<Course>(`/api/v1/courses/${courseId}`),
    probe<CourseContent>(`/api/v1/courses/${courseId}/content`),
    probe<GradeItem[]>(`/api/v1/courses/${courseId}/grade-items`),
    probe<BuilderCriteriaView>(`/api/v1/courses/${courseId}/completion/criteria`),
    probe<CourseGroup[]>(`/api/v1/courses/${courseId}/groups`),
    probe<CourseGrouping[]>(`/api/v1/courses/${courseId}/groupings`),
  ]);
  return {
    course,
    content,
    gradeItems: gradeItems ?? [],
    criteria,
    groups: groups ?? [],
    groupings: groupings ?? [],
  };
}

export async function fetchBuilderCourseList() {
  return (await probe<Course[]>('/api/v1/courses')) ?? [];
}

export function saveBuilderCourse(courseId: string, body: BuilderBody) {
  return apiJson(`/api/v1/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function createBuilderSection(courseId: string, body: BuilderBody) {
  return apiJson(`/api/v1/courses/${courseId}/sections`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function saveBuilderSection(
  courseId: string,
  vars: { sectionId: string; body: BuilderBody },
) {
  return apiJson(`/api/v1/courses/${courseId}/sections/${vars.sectionId}`, {
    method: 'PATCH',
    body: JSON.stringify(vars.body),
  });
}

export function deleteBuilderSection(courseId: string, sectionId: string) {
  return apiJson(`/api/v1/courses/${courseId}/sections/${sectionId}`, { method: 'DELETE' });
}

export function duplicateBuilderSection(courseId: string, sectionId: string) {
  return apiJson(`/api/v1/courses/${courseId}/sections/${sectionId}/copy`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function reorderBuilderSections(courseId: string, sectionIds: string[]) {
  return apiJson(`/api/v1/courses/${courseId}/reorder-sections`, {
    method: 'POST',
    body: JSON.stringify({ sectionIds }),
  });
}

export function reorderBuilderModules(
  courseId: string,
  vars: { sectionId: string; moduleIds: string[] },
) {
  return apiJson(`/api/v1/courses/${courseId}/sections/${vars.sectionId}/reorder-modules`, {
    method: 'POST',
    body: JSON.stringify({ moduleIds: vars.moduleIds }),
  });
}

export function createBuilderExamPin(
  courseId: string,
  vars: { sectionId: string; name: string; requestId: string },
) {
  return apiJson<{ id: string }>(`/api/v1/courses/${courseId}/exam-pins`, {
    method: 'POST',
    body: JSON.stringify({ sectionId: vars.sectionId, requestId: vars.requestId, newExam: { name: vars.name } }),
  });
}

export function createBuilderAssignment(
  courseId: string,
  vars: { sectionId: string; name: string },
) {
  return apiJson<{ id: string }>(`/api/v1/courses/${courseId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ sectionId: vars.sectionId, name: vars.name }),
  });
}

export function createBuilderModule(courseId: string, body: BuilderBody) {
  return apiJson(`/api/v1/courses/${courseId}/modules`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function saveBuilderModule(courseId: string, vars: { cmId: string; body: BuilderBody }) {
  return apiJson(`/api/v1/courses/${courseId}/modules/${vars.cmId}`, {
    method: 'PATCH',
    body: JSON.stringify(vars.body),
  });
}

export function deleteBuilderModule(courseId: string, cmId: string) {
  return apiJson(`/api/v1/courses/${courseId}/modules/${cmId}`, { method: 'DELETE' });
}

export function duplicateBuilderModule(courseId: string, cmId: string) {
  return apiJson(`/api/v1/courses/${courseId}/modules/${cmId}/copy`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function importBuilderContent(courseId: string, body: BuilderBody) {
  return apiJson(`/api/v1/courses/${courseId}/import-content`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function saveBuilderCriteria(courseId: string, body: BuilderBody) {
  return apiJson(`/api/v1/courses/${courseId}/completion/criteria`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function recalculateBuilderCompletion(courseId: string) {
  return apiJson(`/api/v1/courses/${courseId}/completion/recalculate`, { method: 'POST' });
}

export function updateCourseFrameInfo(input: {
  courseId: string;
  subjectId: string | null;
  grade: number | null;
}) {
  return apiJson(`/api/v1/courses/${input.courseId}`, {
    method: 'PATCH',
    body: JSON.stringify({ subjectId: input.subjectId, grade: input.grade }),
  });
}

export function applyCurriculumFrame(input: {
  courseId: string;
  curriculumId: string;
  nodeIds: string[];
  insertAtSection?: number;
}) {
  return apiJson<{ sections: unknown[] }>(`/api/v1/courses/${input.courseId}/curriculum-frame`, {
    method: 'POST',
    body: JSON.stringify({
      curriculumId: input.curriculumId,
      nodeIds: input.nodeIds,
      ...(input.insertAtSection !== undefined ? { insertAtSection: input.insertAtSection } : {}),
    }),
  });
}

export function applyBookFrame(input: {
  courseId: string;
  bookId: string;
  chapterNodeIds: string[];
  insertAtSection?: number;
}) {
  return apiJson<{ sections: unknown[] }>(`/api/v1/courses/${input.courseId}/book-frame`, {
    method: 'POST',
    body: JSON.stringify({
      bookId: input.bookId,
      chapterNodeIds: input.chapterNodeIds,
      ...(input.insertAtSection !== undefined ? { insertAtSection: input.insertAtSection } : {}),
    }),
  });
}
