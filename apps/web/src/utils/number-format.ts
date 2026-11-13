/**
 * Định dạng SỐ dùng chung.
 *
 * Vai trò: một nơi duy nhất cho các khuôn số hiển thị từng bị định nghĩa lại ở nhiều chỗ — hiện có `scoreLabel` (số điểm theo ngôn ngữ).
 *
 * Ranh giới: `utils/date-format.ts` tự ghi rõ định dạng SỐ không đi qua module ngày giờ; module này là phía đối ứng cho số — mọi khuôn số
 * dùng chung mới đều thêm vào đây thay vì định nghĩa lại tại chỗ.
 */

/**
 * Số điểm hiển thị theo ngôn ngữ (tối đa 2 chữ số thập phân, không ép 0) — cùng quy ước trang phụ huynh.
 *
 * @param value - Điểm cần hiển thị.
 * @param locale - Ngôn ngữ hiển thị.
 * @returns Chuỗi điểm đã định dạng.
 */
export function scoreLabel(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
