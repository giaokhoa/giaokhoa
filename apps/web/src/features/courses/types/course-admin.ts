/**
 * Kiểu dữ liệu của trang quản trị khoá học thuộc feature courses. Tách từ module dữ liệu phẳng `src/lib/course-admin-data.ts` khi tổ chức lại apps/web theo mô hình features/ (issue #500): kiểu nằm ở tầng types/, lời gọi API thuần ở tầng api/, tuỳ chọn truy vấn và đột biến ở tầng queries/.
 */

/** Một dòng thành viên (nhóm khoá hoặc cohort): userId + thời điểm thêm. */
export interface MemberRow {
  userId: string;
  timeAdded: string;
}

/**
 * Trạng thái ghi danh của học viên trong khoá: 0 đang học, 1 tạm khoá, 2 đã rút. Gốc ở contracts (`userEnrolmentSchema.status`) là số trần chưa có enum — sửa bền vững là thêm enum ở contracts rồi thay hằng này (xem B4 báo cáo rà soát 2026-11-13).
 */
export const ENROLMENT_STATUS = { active: 0, suspended: 1, withdrawn: 2 } as const;

/** Hội thoại chat toàn lớp của khoá (GET ensure phía messaging). */
export interface CourseConversationView {
  id: string;
  enabled: boolean;
}
