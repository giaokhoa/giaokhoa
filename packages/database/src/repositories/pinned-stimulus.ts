import { stimulusSchema, type Stimulus } from '@giaokhoa/shared/questions';

/**
 * Ngữ liệu phục vụ bài giao phải là bản được chốt cùng đề, không được truy vấn
 * ngữ liệu soạn thảo hiện tại. Bản chụp cũ thiếu trường này không được cấp tệp.
 */
export function readPinnedStimulus(snapshot: unknown, expectedId: string): Stimulus | null {
  const parsed = stimulusSchema.safeParse(snapshot);
  return parsed.success && parsed.data.id === expectedId ? parsed.data : null;
}
