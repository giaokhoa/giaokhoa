import type { CourseContent } from "@giaokhoa/contracts";
import { queryOptions } from "@tanstack/react-query";
import { apiJson } from "#lib/api";
import { queryKeys } from "#lib/query-keys";

export async function fetchCourseContent(
  courseId: string,
): Promise<CourseContent | null> {
  try {
    return await apiJson<CourseContent>(`/api/v1/courses/${courseId}/content`);
  } catch {
    return null;
  }
}

export function courseContentQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseContent(courseId),
    queryFn: () => fetchCourseContent(courseId),
  });
}
