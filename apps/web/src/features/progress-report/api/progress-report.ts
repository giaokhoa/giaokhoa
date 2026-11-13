import { ApiError, apiJson } from '#lib/api';
import type { CourseGroup, ProgressReport } from '../types/progress-report';

/**
 * Tầng gọi API thuần của trang báo cáo tiến độ thuộc feature progress-report: chỉ chứa các hàm gọi HTTP, không phụ thuộc React hay React Query. Tầng `queries/` của feature bọc các hàm này thành queryOptions và hook. Tách từ module dữ liệu phẳng `src/lib/progress-report-data.ts` khi tổ chức lại apps/web theo mô hình features/ (issue #500).
 */

/**
 * Tải một endpoint phụ độc lập: chỉ 403 (không có quyền) mới trả null để trang hiện trạng thái bị cấm; lỗi khác (mạng sập, 500, timeout) ném lên để tầng query/trang phân biệt được lỗi tải với trạng thái bị cấm, thay vì gộp mọi lỗi thành "không có quyền" như probe cũ.
 */
async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.problem.status === 403) return null;
    throw err;
  }
}

/**
 * Đọc báo cáo tiến độ (GET /courses/:id/progress/report, lọc theo
 * nhóm khi có); chỉ 403 mới trả null (trang hiểu là không có quyền),
 * lỗi tải khác ném lên để trang hiện thông báo lỗi tải riêng.
 *
 * @param courseId - Định danh khoá.
 * @param groupId - Định danh nhóm lọc (rỗng = toàn khoá).
 * @returns Báo cáo tiến độ hoặc null khi không có quyền.
 */
export function fetchProgressReport(courseId: string, groupId: string) {
  return probe<ProgressReport>(
    `/api/v1/courses/${courseId}/progress/report${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`,
  );
}

/**
 * Đọc danh sách nhóm của khoá cho bộ lọc của báo cáo
 * (GET /courses/:id/groups); chỉ 403 mới trả null, lỗi khác ném lên.
 *
 * @param courseId - Định danh khoá.
 * @returns Danh sách nhóm hoặc null khi không có quyền.
 */
export function fetchProgressReportGroups(courseId: string) {
  return probe<CourseGroup[]>(`/api/v1/courses/${courseId}/groups`);
}
