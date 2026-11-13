/**
 * Định dạng tên hiển thị dùng chung.
 *
 * Vai trò: một nơi duy nhất cho hai helper tên từng bị định nghĩa lại ở nhiều chỗ với quy tắc khác nhau — `initialsOf` (chữ viết tắt cho
 * AvatarFallback) và `personName` (họ tên "Họ Tên" của một hồ sơ người dùng).
 *
 * Ranh giới: module này chỉ chứa hàm thuần về tên, không phụ thuộc React hay API; mọi bề mặt cần tên hiển thị (avatar ở sidebar, hàng hội thoại,
 * danh sách lớp, bề mặt phụ huynh) đều dùng chung một quy tắc.
 */

/**
 * Chữ viết tắt của tên hiển thị — nội dung AvatarFallback.
 *
 * Luật (issue #591): chỉ lấy KÝ TỰ CHỮ — ký tự đặc biệt ở đầu tên (ví dụ tên nhóm bắt đầu bằng dấu ngoặc như "[KT] Nhóm…") bị bỏ qua, không lọt
 * vào chữ viết tắt như trước. Cách lấy giữ cùng khuôn với tên người: tách tên thành các TỪ CHỮ (mỗi từ chỉ giữ các ký tự chữ Unicode của nó, từ
 * không còn ký tự chữ nào thì bỏ hẳn); từ hai từ chữ trở lên thì lấy chữ đầu của từ đầu + chữ đầu của từ cuối; đúng một từ chữ thì lấy hai chữ
 * đầu của từ đó; không có ký tự chữ nào thì rơi về '?'.
 *
 * @param name - Tên hiển thị cần rút gọn.
 * @returns Chữ viết tắt (tối đa 2 ký tự, viết hoa), hoặc '?' khi tên không có ký tự chữ nào.
 */
export function initialsOf(name: string): string {
  const letterWords = name
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).filter((ch) => /\p{L}/u.test(ch)).join(''))
    .filter(Boolean);
  const firstWord = letterWords[0];
  if (!firstWord) return '?';
  if (letterWords.length === 1) return Array.from(firstWord).slice(0, 2).join('').toUpperCase();
  const lastWord = letterWords[letterWords.length - 1];
  const first = Array.from(firstWord)[0];
  const last = lastWord ? Array.from(lastWord)[0] : undefined;
  if (!first || !last) return '?';
  return (first + last).toUpperCase();
}

/**
 * Tên hiển thị "Họ Tên" của một hồ sơ người dùng; rơi về username khi thiếu tên.
 *
 * @param p - Hồ sơ người dùng (họ, tên, tên đăng nhập).
 * @returns "Họ Tên" đã cắt khoảng trắng thừa, hoặc username khi không có họ tên.
 */
export function personName(p: { firstName: string; lastName: string; username: string }): string {
  const full = `${p.lastName} ${p.firstName}`.trim();
  return full || p.username;
}
