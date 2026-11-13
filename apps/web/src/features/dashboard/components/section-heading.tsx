/**
 * Tiêu đề dùng chung cho các khối vai trò của trang tổng quan
 * (`admin-section`, `teacher-section`, `student-section`): một dòng
 * tiêu đề cấp khối với testid cố định để spec neo theo. Tách ra từ
 * `dashboard.tsx` (S4) vì cả ba khối vai trò đều dùng cùng một kiểu
 * tiêu đề — giữ ở đây để đổi kiểu tiêu đề chỉ chạm một chỗ.
 */

/** Tiêu đề một khối vai trò trên trang tổng quan. */
export function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="px-4 text-lg font-semibold lg:px-6" data-testid="dashboard-section-title">
      {title}
    </h2>
  );
}
