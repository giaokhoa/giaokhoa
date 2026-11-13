/**
 * Tiện ích thuần của trang lần ghim đề (tách cấu trúc từ `pages/quiz.tsx` theo đợt A của issue #223): trích text thuần từ tài liệu rich text và chuyển mốc thời gian ISO sang giá trị cho input `datetime-local`. Không phụ thuộc React hay API.
 */
import {
  extractRichTextPlainText,
  type PinVersionUpdateSlotDiff,
  type QuizAttemptState,
  type QuizGradeMethod,
  type RichTextDocument,
} from '@giaokhoa/contracts';

/** Nhãn phương pháp tính điểm quiz (highest/average/first/last). */
export const QUIZ_GRADE_METHOD_LABEL_KEYS: Record<QuizGradeMethod, string> = {
  highest: 'quizGradeMethod_highest',
  average: 'quizGradeMethod_average',
  first: 'quizGradeMethod_first',
  last: 'quizGradeMethod_last',
};

const QUIZ_ATTEMPT_STATE_LABEL_KEYS: Record<QuizAttemptState, string> = {
  inprogress: 'quizAttemptState_inprogress',
  needsgrading: 'quizAttemptState_needsgrading',
  finished: 'quizAttemptState_finished',
};

/**
 * Khoá i18n cho trạng thái lượt làm quiz. API trả `state` dạng chuỗi tự do (contracts chưa khai enum ở QuizAttemptSummary) nên tra Record theo 3 trạng thái đã biết; trạng thái lạ thì giữ đúng hành vi cũ — ghép khoá để i18next fallback hiển thị khoá thay vì lặng lẽ sai nhãn.
 */
export function quizAttemptStateKey(state: string): string {
  if (state === 'inprogress' || state === 'needsgrading' || state === 'finished') {
    return QUIZ_ATTEMPT_STATE_LABEL_KEYS[state];
  }
  return `quizAttemptState_${state}`;
}

/** Nhãn loại thay đổi của một slot trong bản xem trước cập nhật version của pin (issue #254). */
export const DIFF_CHANGE_LABEL_KEYS: Record<PinVersionUpdateSlotDiff['change'], string> = {
  added: 'diffChange_added',
  removed: 'diffChange_removed',
  question_changed: 'diffChange_question_changed',
  question_version_changed: 'diffChange_question_version_changed',
  mark_changed: 'diffChange_mark_changed',
  unchanged: 'diffChange_unchanged',
};

/** Trích text thuần từ tài liệu rich text; tài liệu trống/thiếu thì trả chuỗi rỗng. */
export function plainText(doc: RichTextDocument | null | undefined): string {
  return doc ? extractRichTextPlainText(doc) : '';
}

/** Chuyển giá trị Date của API sang giá trị cho input datetime-local. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
