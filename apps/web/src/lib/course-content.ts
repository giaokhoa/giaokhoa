/**
 * Tầng dữ liệu nội dung khoá dùng chung cho nhiều feature: trình dựng khoá, ngân hàng
 * nội dung, đề thi và câu hỏi đều đọc cùng một query nội dung khoá qua đây thay vì
 * mỗi feature tự gọi API. Query đọc lười theo khoá và dùng chung cache qua khoá factory.
 */

import type { CourseContent } from "@giaokhoa/contracts";
import { queryOptions } from "@tanstack/react-query";
import { probe } from "#lib/api";
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
  return probe<CourseContent>(`/api/v1/courses/${courseId}/content`);
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
