/**
 * Làm tròn đến chữ số thập phân thứ nhất, khử nhiễu dấu phẩy động ở biên
 * ,5 (cộng `Number.EPSILON` trước khi làm tròn để 8.25 không rơi xuống
 * 8.2 vì 82.5 lưu nhị phân thành 82.4999…). Kết quả -0 được chuẩn hoá
 * về 0. Đây là biến thể DUY NHẤT được dùng trong apps/api cho mọi phép
 * làm tròn 1 chữ số thập phân (điểm, tỉ lệ phần trăm) — không viết lại
 * `Math.round(v * 10) / 10` ở nơi khác.
 */
export function roundToOneDecimal(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}
