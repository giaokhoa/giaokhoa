/**
 * Helper nhỏ dùng chung của feature matrices: lấy khoá đầu tiên làm
 * cổng đọc, tra nhãn mức nhận thức/dạng câu hỏi, và nhãn bảng dữ
 * liệu — các biểu thức này trước đây lặp lại giữa màn tạo ma trận
 * tay và màn nhập ma trận (và trong cùng một file ở màn nhập).
 */
import type { DataTableLabels } from '#components/data-table';
import { COGNITIVE_LEVELS, LEVEL_LABEL_KEYS, QTYPES, QTYPE_LABEL_KEYS } from '#features/questions/utils/shared';

/**
 * Khoá đầu tiên trong danh sách khoá của giáo viên, dùng làm
 * `forCourseId` khi đọc môn/chương trình: khoá nào cũng cho cùng
 * danh sách (chỉ mở cổng đọc, không lọc theo khoá), nên lấy khoá
 * đầu tiên là đủ.
 *
 * @param courses - Danh sách khoá của giáo viên (undefined khi chưa tải xong).
 * @returns Id khoá đầu tiên, hoặc undefined khi chưa có danh sách.
 */
export function firstCourseId(courses: readonly { id: string }[] | undefined): string | undefined {
  return courses?.[0]?.id;
}

/**
 * Khoá i18n cho nhãn mức nhận thức của một ô ma trận. Giá trị ngoài
 * bộ mức đã biết (dữ kiện lạ từ server) rơi về nhãn mặc định
 * `levelBiet` thay vì tra khoá undefined — cùng luật với màn tạo
 * ma trận tay trước đây.
 *
 * @param level - Mã mức nhận thức của ô.
 * @returns Khoá i18n của nhãn mức.
 */
export function levelLabelKey(level: string): string {
  return LEVEL_LABEL_KEYS[level as (typeof COGNITIVE_LEVELS)[number]] ?? 'levelBiet';
}

/**
 * Khoá i18n cho nhãn dạng câu hỏi của một ô ma trận. Giá trị ngoài
 * bộ dạng đã biết rơi về nhãn mặc định `qtypeMultichoice` — cùng
 * luật với màn tạo ma trận tay trước đây.
 *
 * @param qtype - Mã dạng câu hỏi của ô.
 * @returns Khoá i18n của nhãn dạng câu hỏi.
 */
export function qtypeLabelKey(qtype: string): string {
  return QTYPE_LABEL_KEYS[qtype as (typeof QTYPES)[number]] ?? 'qtypeMultichoice';
}

/**
 * Nhãn bảng dữ liệu dùng chung của các bảng trong feature matrices
 * (cột, chuyển trang, bảng trống, thông tin trang) — dịch từ
 * namespace `dashboard` qua hàm `t` của trang gọi.
 *
 * @param t - Hàm dịch của trang gọi.
 * @returns Nhãn `DataTableLabels` cho `DataTable`.
 */
export function dashboardTableLabels(t: (key: string, opts?: Record<string, unknown>) => string): DataTableLabels {
  return {
    columns: t('dashboard:tableColumns'),
    previous: t('dashboard:tablePrevious'),
    next: t('dashboard:tableNext'),
    empty: t('dashboard:emptyTable'),
    pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
  };
}
