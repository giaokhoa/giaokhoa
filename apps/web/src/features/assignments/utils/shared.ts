import { formatWithOptions } from '#utils/date-format';
import type {
  AssignAnnotationKind,
  AssignCommentBankCategory,
  AssignGradeLevel,
  AssignResultMode,
  AssignSubmissionStatus,
} from '@giaokhoa/contracts';

// Khuôn dùng chung của các bề mặt Bài tập (trang assignment và các panel con).

/** Nhãn loại dấu chấm vector trên bề mặt bài nộp (correct/incorrect/draw/note/highlight/frame). */
export const ASSIGN_KIND_LABEL_KEYS: Record<AssignAnnotationKind, string> = {
  correct: 'assignKind_correct',
  incorrect: 'assignKind_incorrect',
  draw: 'assignKind_draw',
  note: 'assignKind_note',
  highlight: 'assignKind_highlight',
  frame: 'assignKind_frame',
};

/** Nhãn nhóm của một câu trong ngân hàng lời phê cá nhân (3 ô + tiến bộ). */
export const ASSIGN_BANK_CATEGORY_LABEL_KEYS: Record<AssignCommentBankCategory, string> = {
  strengths: 'assignBankCat_strengths',
  weaknesses: 'assignBankCat_weaknesses',
  improvement: 'assignBankCat_improvement',
  progress: 'assignBankCat_progress',
  general: 'assignBankCat_general',
};

/** Nhãn trạng thái bài nộp của học sinh (none/draft/submitted/graded). */
export const ASSIGN_STATUS_LABEL_KEYS: Record<AssignSubmissionStatus, string> = {
  none: 'assignStatus_none',
  draft: 'assignStatus_draft',
  submitted: 'assignStatus_submitted',
  graded: 'assignStatus_graded',
};

/**
 * Nhãn trạng thái gói chấm phía giáo viên: 'none' = chưa chấm (API trả kèm — khác ASSIGN_GRADE_STATUSES của contracts chỉ có draft/released).
 */
export const ASSIGN_GRADE_STATUS_LABEL_KEYS: Record<'none' | 'draft' | 'released', string> = {
  none: 'assignGradeStatus_none',
  draft: 'assignGradeStatus_draft',
  released: 'assignGradeStatus_released',
};

/** Nhãn mức kết quả của bài ở chế độ chỉ-nhận-xét (Đạt / Chưa đạt). */
export const ASSIGN_LEVEL_LABEL_KEYS: Record<AssignGradeLevel, string> = {
  dat: 'assignLevel_dat',
  chua_dat: 'assignLevel_chua_dat',
};

/** Nhãn chế độ kết quả của bài tập (score/level/score_feedback, theo TT 22/2021 Điều 5). */
export const ASSIGN_RESULT_MODE_LABEL_KEYS: Record<AssignResultMode, string> = {
  score: 'assignResultMode_score',
  level: 'assignResultMode_level',
  score_feedback: 'assignResultMode_score_feedback',
};

/** Định dạng mốc thời gian ISO cho người đọc (theo ngôn ngữ trình duyệt). */
export function dateLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatWithOptions(d, undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

