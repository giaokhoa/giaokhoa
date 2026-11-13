import type { CourseContent } from "@giaokhoa/contracts";
import { queryOptions } from "@tanstack/react-query";
import { apiJson } from "#lib/api";
import { queryKeys } from "#lib/query-keys";

/**
 * Đường đọc nội dung khoá dùng chung giữa builder, ngân hàng học liệu và đề.
 * Gặp lỗi mạng hoặc API thì trả null, giữ hành vi probe đã có ở builder.
 *
 * @param courseId - Khoá học cần đọc nội dung.
 * @returns Nội dung khoá, hoặc null nếu không đọc được.
 */
export async function fetchCourseContent(
  courseId: string,
): Promise<CourseContent | null> {
  try {
    return await apiJson<CourseContent>(`/api/v1/courses/${courseId}/content`);
  } catch {
    return null;
  }
}

/**
 * Một cache key và một cách đọc cho mọi feature dùng nội dung khoá.
 *
 * @param courseId - Khoá học cần đọc nội dung.
 * @returns Tuỳ chọn TanStack Query giữ cùng key và null semantics.
 */
export function courseContentQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseContent(courseId),
    queryFn: () => fetchCourseContent(courseId),
  });
}
