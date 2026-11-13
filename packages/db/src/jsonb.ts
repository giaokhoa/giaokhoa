/**
 * Helper serialize duy nhất của package cho mọi giá trị ghi vào cột jsonb.
 *
 * Vì sao cần serialize tường minh: driver `pg` tự `JSON.stringify` object
 * thường khi gắn tham số, nhưng mảng ở cấp cao nhất bị hiểu là mảng
 * PostgreSQL → cột jsonb báo lỗi cú pháp. Mọi giá trị jsonb đều đi qua
 * helper này (khuôn §4 của PLAYBOOK trong `AGENTS.md` của package), để
 * hành vi serialize chỉ có một nơi duy nhất cần sửa — trước đây mỗi file
 * repository giữ một bản sao giống hệt nhau (24 bản, 4 biến thể chữ ký),
 * sửa một chỗ là sót 23 chỗ còn lại.
 *
 * Chữ ký duy nhất: `jsonbValue<T = JsonValue>(value: unknown)`. Kiểu đích
 * mặc định là `JsonValue` (alias của `Json` trong kiểu sinh); nơi gọi cần
 * kiểu đích hẹp hơn thì truyền tường minh, ví dụ
 * `jsonbValue<LearningOutcomeDoc>(doc)`.
 */
import { sql, type RawBuilder } from 'kysely';
import type { JsonValue } from './types/centre-db';

/**
 * Serialize một giá trị thành biểu thức `::jsonb` để ghi vào cột jsonb.
 *
 * @param value - Giá trị cần ghi; `JSON.stringify` được gọi tường minh ở
 *   đây nên mảng cấp cao nhất cũng thành JSON hợp lệ, không bị driver hiểu
 *   là mảng PostgreSQL.
 */
export function jsonbValue<T = JsonValue>(value: unknown): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

/**
 * Giá trị jsonb nullable với ba trạng thái phân biệt (dùng ở mọi điểm ghi
 * cột jsonb có thể null):
 *
 * - `undefined` → bỏ qua: Kysely loại cột khỏi `.values()`/`.set()` nên
 *   insert lấy mặc định của cột, update giữ nguyên giá trị cũ.
 * - `null` → SQL NULL: ghi NULL thật vào cột, KHÔNG phải JSON `null`
 *   (vì `JSON.stringify(null)` là chuỗi `"null"` nên `jsonbValue(null)`
 *   sẽ ghi JSON `null`, khác hẳn SQL NULL).
 * - Còn lại → serialize qua `jsonbValue`.
 */
export function jsonbField(value: unknown): RawBuilder<JsonValue> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return jsonbValue(value);
}
