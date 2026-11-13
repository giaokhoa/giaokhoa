/**
 * Class dùng chung cho các ô chọn (select) của form.
 *
 * Vai trò: một hằng duy nhất cho khuôn ô chọn từng bị định nghĩa lại ở nhiều route với chuỗi class gần giống nhau — trước đây
 * `matrix-import.tsx` và `question-matrix.tsx` dùng cùng một chuỗi, còn `class-edit.tsx` dùng một biến thể (px-3, tiền tố flex, không
 * shadow-xs). Thống nhất về một biến thể duy nhất để mọi ô chọn của form có cùng hình dạng.
 */

/** Khuôn ô chọn của form: cao 36px, bo góc, viền input, nền trong suốt, đệm ngang 10px, chữ 14px, bóng mờ nhẹ. */
export const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs';
