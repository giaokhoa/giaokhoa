/**
 * Lớp CSS dùng chung cho các ô `<select>` của form (shadcn-style, nền trong suốt): một hằng duy nhất cho toàn app thay vì mỗi feature tự định nghĩa lại cùng chuỗi. Đặt ở tầng dùng chung vì 4 feature (assignments, course-builder, courses, content-bank) cùng cần — import ngang giữa các feature cho hằng này nằm ngoài tập cạnh đóng băng (issue #500), nên không để định nghĩa ở feature nào.
 */
export const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
