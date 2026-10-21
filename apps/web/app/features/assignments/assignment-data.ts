import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import type { Assignment } from '@giaokhoa/shared/assignments';
import {
  essayContentSchema,
  multipleChoiceContentSchema,
  shortAnswerContentSchema,
  trueFalseContentSchema,
  type QuestionType,
} from '@giaokhoa/shared/questions';

export const assignmentDateFields = [
  'openAt',
  'closeAt',
  'releaseScoreAt',
  'releaseFeedbackAt',
  'releaseSolutionsAt',
  'createdAt',
  'publishedAt',
] as const;

export const scheduleFields = [
  { name: 'openAt', label: 'Mở bài lúc', required: true },
  { name: 'closeAt', label: 'Đóng bài lúc', required: true },
  { name: 'releaseScoreAt', label: 'Công bố điểm lúc', required: false },
  { name: 'releaseFeedbackAt', label: 'Công bố nhận xét lúc', required: false },
  { name: 'releaseSolutionsAt', label: 'Công bố lời giải lúc', required: false },
] as const;

/** Chỉ khôi phục những trường ngày đã khai báo; giữ nguyên null và nội dung đề. */
export function normalizeDates(value: unknown, fields: readonly string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result: Record<string, unknown> = { ...value };
  for (const field of fields) {
    const date = result[field];
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date)) {
      result[field] = new Date(date);
    }
  }
  return result;
}

export function toLocalDateTime(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
}

/** Chạy trên trình duyệt để dùng múi giờ tại chính thời điểm được chọn, kể cả giờ mùa hè. */
export function localDateTimeToIso(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !toLocalDateTime(date).startsWith(value))
    return undefined;
  return date.toISOString();
}

export function readAssignmentForm(form: FormData, assignment?: Assignment) {
  function text(name: string) {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  }
  return assignmentsContract.create.body.safeParse({
    classId: assignment?.classId ?? text('classId'),
    examRevisionId: assignment?.examRevisionId ?? text('examRevisionId'),
    audienceMode: form.get('audienceMode'),
    selectedUserIds: text('selectedUserIds')
      .split(/[\s,;]+/)
      .filter(Boolean),
    openAt: form.get('openAt'),
    closeAt: form.get('closeAt'),
    maxAttempts: Number(form.get('maxAttempts')),
    releaseScoreAt: form.get('releaseScoreAt') || null,
    releaseFeedbackAt: form.get('releaseFeedbackAt') || null,
    releaseSolutionsAt: form.get('releaseSolutionsAt') || null,
  });
}

export function assignmentFieldErrors(
  issues: readonly { path: PropertyKey[]; code: string; message: string }[],
) {
  const messages: Record<string, string> = {
    classId: 'Mã lớp phải là UUID phiên bản 7.',
    examRevisionId: 'Mã phiên bản đề phải là UUID phiên bản 7.',
    audienceMode: 'Hãy chọn cả lớp hoặc học sinh cụ thể.',
    selectedUserIds: 'Nhập tối đa 5.000 mã học sinh, mỗi mã là UUID phiên bản 7.',
    maxAttempts: 'Số lượt làm phải là số nguyên từ 1 đến 100.',
  };
  return Object.fromEntries(
    issues.map((issue) => {
      const field = String(issue.path[0] ?? 'form');
      return [
        field,
        issue.code === 'custom' ? issue.message : (messages[field] ?? 'Ngày giờ không hợp lệ.'),
      ];
    }),
  );
}

export function formatAssignmentDate(value: Date | string | null): string {
  if (value === null) return 'Chưa đặt';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Ngày giờ không hợp lệ';
  return (
    new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}

/** Nội dung delivery là unknown; kiểm tra đúng dạng và từ chối các khóa lời giải ngoài hợp đồng. */
export function parseDeliveryContent(type: QuestionType, value: unknown) {
  const schemas = {
    multiple_choice: multipleChoiceContentSchema,
    true_false: trueFalseContentSchema,
    short_answer: shortAnswerContentSchema,
    essay: essayContentSchema,
  };
  return schemas[type].safeParse(value);
}
