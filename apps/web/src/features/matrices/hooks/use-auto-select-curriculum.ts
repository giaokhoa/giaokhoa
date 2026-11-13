/**
 * Tự chọn chương trình khi đổi môn — dùng chung cho màn tạo ma trận
 * tay và màn nhập ma trận (trước đây khối này lặp hệt ở cả hai màn).
 *
 * Nhịp "effect thủ công" bằng setState-trong-render: khi môn hoặc
 * danh sách chương trình đổi, giữ lựa chọn chương trình nếu còn
 * thuộc môn mới, không thì tự chọn chương trình đầu; chưa chọn môn
 * thì xoá lựa chọn. Giữ nguyên nhịp này (không đổi thành useEffect)
 * để hành vi chọn chương trình không lệch với các màn đang chạy.
 */
import { useState } from 'react';
import type { CurriculumLite } from '../types/matrix';

/**
 * Đồng bộ lựa chọn chương trình theo môn đang chọn.
 *
 * @param subjectId - Môn đang chọn (rỗng thì xoá lựa chọn chương trình).
 * @param curricula - Danh sách chương trình của môn (undefined khi chưa tải xong).
 * @param setCurriculumId - Setter của state chương trình đang chọn.
 */
export function useAutoSelectCurriculum({
  subjectId,
  curricula,
  setCurriculumId,
}: {
  subjectId: string;
  curricula: CurriculumLite[] | undefined;
  setCurriculumId: (updater: (prev: string) => string) => void;
}): void {
  const [previousScope, setPreviousScope] = useState({
    subjectId: '',
    curricula: undefined as CurriculumLite[] | undefined,
  });
  if (previousScope.subjectId !== subjectId || previousScope.curricula !== curricula) {
    setPreviousScope({ subjectId, curricula });
    if (!subjectId) {
      setCurriculumId(() => '');
    } else if (curricula) {
      setCurriculumId((prev) => (curricula.some((c) => c.id === prev) ? prev : (curricula[0]?.id ?? '')));
    }
  }
}
