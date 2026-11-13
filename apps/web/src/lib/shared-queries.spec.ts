import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "#lib/api";
import { queryKeys } from "#lib/query-keys";
import {
  courseContentQueryOptions,
  fetchCourseContent,
} from "./course-content";
import { curriculumSubjectsQueryOptions, fetchSubjects } from "./curriculum";

vi.mock("#lib/api", () => ({ apiJson: vi.fn() }));

/**
 * Khoá cache và đường đọc dùng chung phải giữ nguyên sau khi tách khỏi
 * các feature ma trận và builder; các route dùng lại cùng query options.
 */
describe("query dùng chung giữa các feature", () => {
  beforeEach(() => vi.mocked(apiJson).mockReset());

  it("nội dung khoá dùng chung key với builder và trả null khi API lỗi", async () => {
    const courseId = "01900000-0000-7000-8000-000000000001";
    expect(courseContentQueryOptions(courseId).queryKey).toEqual(
      queryKeys.courseContent(courseId),
    );

    vi.mocked(apiJson).mockRejectedValueOnce(new Error("offline"));
    await expect(fetchCourseContent(courseId)).resolves.toBeNull();
    expect(apiJson).toHaveBeenCalledWith(
      "/api/v1/courses/" + courseId + "/content",
    );
  });

  it("môn chương trình giữ key cũ và key riêng theo khoá mở quyền", async () => {
    const courseId = "01900000-0000-7000-8000-000000000002";
    expect(curriculumSubjectsQueryOptions().queryKey).toEqual(
      queryKeys.curriculumSubjects,
    );
    expect(curriculumSubjectsQueryOptions(courseId).queryKey).toEqual([
      ...queryKeys.curriculumSubjects,
      courseId,
    ]);

    vi.mocked(apiJson).mockResolvedValueOnce([]);
    await expect(fetchSubjects(undefined, courseId)).resolves.toEqual([]);
    expect(apiJson).toHaveBeenCalledWith(
      "/api/v1/curriculum/subjects?forCourseId=" + courseId,
    );
  });
});
