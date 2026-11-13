import { useQueries } from '@tanstack/react-query';
import type { CourseActivityGrid, MyActivityGrades } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';


export interface CourseGradeData {
  report: CourseActivityGrid | null;
  gradebook: MyActivityGrades | null;
}

async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export async function fetchCourseGradeData(courseId: string): Promise<CourseGradeData> {
  const [report, gradebook] = await Promise.all([
    probe<CourseActivityGrid>(`/api/v1/courses/${courseId}/gradebook/report`),
    probe<MyActivityGrades>(`/api/v1/courses/${courseId}/gradebook`),
  ]);
  return { report, gradebook };
}

export function useCoursesGradeData(courseIds: string[]) {
  const queries = useQueries({
    queries: courseIds.map((courseId) => ({
      queryKey: queryKeys.courseAccess(courseId),
      queryFn: () => fetchCourseGradeData(courseId),
    })),
  });
  const map = new Map<string, CourseGradeData>();
  courseIds.forEach((courseId, i) => {
    const data = queries[i]?.data;
    if (data) map.set(courseId, data);
  });
  return map;
}
