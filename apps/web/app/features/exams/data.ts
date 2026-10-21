import { examsContract } from '@giaokhoa/shared/http/exams';
import type { ExamRevisionCreate } from '@giaokhoa/shared/exams';

export function parseRevisionInput(
  input: unknown,
): { success: true; data: ExamRevisionCreate } | { success: false; error: string } {
  if (typeof input !== 'string' || !input.trim()) {
    return { success: false, error: 'Nhập ít nhất một câu hỏi.' };
  }

  const questions: ExamRevisionCreate['questions'] = [];
  for (const [index, line] of input.split(/\r\n?|\n/).entries()) {
    if (!line.trim()) continue;
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length !== 2 || !/^\d+$/.test(parts[1]!)) {
      return { success: false, error: `Dòng ${index + 1}: nhập đúng dạng questionId,version.` };
    }
    const questionId = parts[0]!.toLowerCase();
    const version = Number(parts[1]);
    if (!examsContract.get.pathParams.safeParse({ id: questionId }).success) {
      return { success: false, error: `Dòng ${index + 1}: mã câu hỏi phải là UUID v7.` };
    }
    if (!Number.isSafeInteger(version) || version < 1) {
      return {
        success: false,
        error: `Dòng ${index + 1}: phiên bản phải là số nguyên dương an toàn.`,
      };
    }
    if (questions.some((question) => question.questionId === questionId)) {
      return { success: false, error: `Dòng ${index + 1}: câu hỏi đã có trong danh sách.` };
    }
    if (questions.length === 100) {
      return { success: false, error: 'Mỗi phiên bản đề chỉ được có tối đa 100 câu hỏi.' };
    }
    questions.push({ questionId, version });
  }

  const result = examsContract.createRevision.body.safeParse({ questions });
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: 'Mỗi phiên bản đề phải có từ 1 đến 100 câu hỏi khác nhau.' };
}

export function normalizeExamDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeExamDates);
  if (!value || typeof value !== 'object') return value;

  const result = { ...value } as Record<string, unknown>;
  // Chỉ chuyển ngày của đề và phiên bản đề, giữ nguyên nội dung bản chụp câu hỏi.
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof result[key] === 'string') result[key] = new Date(result[key]);
  }
  return result;
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

export function formatExamDate(value: Date): string {
  return dateFormatter.format(value);
}
