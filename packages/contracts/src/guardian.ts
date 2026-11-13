import { z } from 'zod';
import { dashboardNewResultViewSchema } from './dashboard.js';

/**
 * Contracts của bề mặt phụ huynh chỉ-xem (PH-1, issue #130 — Đợt 6, xây trên PH-0 #116 và DASH1 #121). Oracle: research phụ huynh/HS mục 4.3
 * (bốn khối rút gọn có chủ đích) + 5.1 (nguyên tắc cứng: chỉ-xem, chỉ con
 * mình, chỉ dữ liệu ĐÃ CÔNG BỐ, không xếp hạng/so sánh/trung bình lớp, không hiện 0 thay cho chưa chấm, không hành động thay con).
 */

/** Một việc của con trong tóm tắt tuần (chỉ hiển thị — không có hành động thay con). */
export const guardianWeeklyItemViewSchema = z.strictObject({
  courseId: z.string(),
  courseName: z.string(),
  cmId: z.string(),
  /** quiz | assignment. */
  kind: z.enum(['quiz', 'assignment']),
  name: z.string(),
  /** Hạn nộp (ISO). */
  dueAt: z.iso.datetime(),
  status: z.enum(['submitted', 'not_submitted', 'overdue']),
});
export type GuardianWeeklyItemView = z.infer<typeof guardianWeeklyItemViewSchema>;

/** Khối (a): tóm tắt tuần của con — việc đã nộp / chưa nộp / quá hạn. */
export const guardianWeeklySummaryViewSchema = z.strictObject({
  /** Đầu tuần hiện tại (ISO, thứ Hai 00:00 UTC). */
  weekStart: z.iso.datetime(),
  /** Cuối tuần hiện tại (ISO, Chủ nhật 23:59:59.999 UTC). */
  weekEnd: z.iso.datetime(),
  /** Số việc có hạn trong tuần này. */
  dueThisWeek: z.number(),
  /** Trong số việc đến hạn tuần này: đã nộp. */
  submitted: z.number(),
  /** Trong số việc đến hạn tuần này: chưa nộp, chưa quá hạn. */
  notSubmitted: z.number(),
  /** Mọi việc chưa nộp đã quá hạn (bất kể hạn thuộc tuần nào). */
  overdue: z.number(),
  /** Danh sách việc: việc của tuần này + mọi việc quá hạn chưa nộp. */
  items: z.array(guardianWeeklyItemViewSchema),
});
export type GuardianWeeklySummaryView = z.infer<typeof guardianWeeklySummaryViewSchema>;

/**
 * Khối (c): một thông báo lớp liên quan tới khoá của con (bản thông báo đã gửi cho chính học sinh). Thông báo điểm (grade_updated) bị loại ở server để cổng công bố là tuyệt đối — nội dung thông báo vốn không chứa điểm số.
 */
export const guardianAnnouncementViewSchema = z.strictObject({
  id: z.string(),
  courseId: z.string(),
  courseName: z.string(),
  subject: z.string(),
  body: z.string(),
  /** Thời điểm thông báo được tạo (ISO). */
  createdAt: z.iso.datetime(),
});
export type GuardianAnnouncementView = z.infer<typeof guardianAnnouncementViewSchema>;

/** Khối (d): tiến độ học theo khoá — đúng ngữ nghĩa hoàn thành của K2. */
export const guardianCourseProgressViewSchema = z.strictObject({
  courseId: z.string(),
  courseName: z.string(),
  /** Số mục học có theo dõi hoàn thành trong khoá. */
  total: z.number(),
  /** Số mục con đã hoàn thành (trạng thái khác 0). */
  completed: z.number(),
  /** % hoàn thành; null khi khoá chưa có mục nào được theo dõi (không hiện 0 giả). */
  percent: z.number().nullable(),
});
export type GuardianCourseProgressView = z.infer<typeof guardianCourseProgressViewSchema>;

/** Toàn bộ bề mặt tổng quan của phụ huynh cho MỘT con trong MỘT response. */
export const guardianStudentOverviewViewSchema = z.strictObject({
  student: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
  /** Thời điểm server tính khối này (ISO). */
  generatedAt: z.iso.datetime(),
  /** Mốc xem trước của chính phụ huynh cho con này (ISO); null ở lần xem đầu. */
  previousSeenAt: z.iso.datetime().nullable(),
  weekly: guardianWeeklySummaryViewSchema,
  /** Khối (b): kết quả ĐÃ CÔNG BỐ mới kể từ mốc xem trước của phụ huynh. */
  newResults: z.array(dashboardNewResultViewSchema),
  announcements: z.array(guardianAnnouncementViewSchema),
  courseProgress: z.array(guardianCourseProgressViewSchema),
});
export type GuardianStudentOverviewView = z.infer<typeof guardianStudentOverviewViewSchema>;

/** Điểm ĐÃ CÔNG BỐ của con ở một bài (một hoạt động) trong khoá — mô hình điểm theo bài, issue #224. */
export const guardianActivityResultViewSchema = z.strictObject({
  itemId: z.string(),
  /** Tên bài (tên grade item). */
  itemName: z.string(),
  /** Điểm hiệu lực của bài; null khi chưa có điểm. */
  finalGrade: z.number().nullable(),
  gradeMax: z.number(),
  /** Lời phê của giáo viên đi kèm điểm; null khi không có. */
  feedback: z.string().nullable(),
});
export type GuardianActivityResultView = z.infer<typeof guardianActivityResultViewSchema>;

/** Kết quả học tập đã công bố của con trong một khoá/môn: điểm theo từng bài, không điểm tổng khoá. */
export const guardianCourseResultsViewSchema = z.strictObject({
  courseId: z.string(),
  courseName: z.string(),
  activities: z.array(guardianActivityResultViewSchema),
});
export type GuardianCourseResultsView = z.infer<typeof guardianCourseResultsViewSchema>;

/** Bề mặt kết quả học tập đã công bố của con, theo từng khoá/môn. */
export const guardianStudentResultsViewSchema = z.strictObject({
  student: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
  courses: z.array(guardianCourseResultsViewSchema),
});
export type GuardianStudentResultsView = z.infer<typeof guardianStudentResultsViewSchema>;

/**
 * PH-2 (issue #159): digest phụ huynh — tần suất tổng hợp đẩy ra cho từng cặp (phụ huynh, con). Mặc định `weekly` theo research mục 1.4
 * (không push từng điểm lẻ); `daily` là tuỳ chọn của phụ huynh; `off`
 * chỉ tắt digest ĐỊNH KỲ. Đẩy riêng quá hạn ≥7 ngày là ngoại lệ tách khỏi digest (research điểm chính sách 6) nên vẫn chạy bất kể tần suất — kể cả khi phụ huynh chọn `off`.
 */
/** Tần suất digest phụ huynh (xem TSDoc ở khối PH-2 phía dưới). */
export const guardianDigestFrequencySchema = z.enum(['weekly', 'daily', 'off']);
export type GuardianDigestFrequency = z.infer<typeof guardianDigestFrequencySchema>;

/** Tuỳ chọn digest của chính phụ huynh cho một con. */
export const guardianDigestPreferenceViewSchema = z.strictObject({
  studentId: z.string(),
  frequency: guardianDigestFrequencySchema,
});
export type GuardianDigestPreferenceView = z.infer<typeof guardianDigestPreferenceViewSchema>;

/** Thân PUT tuỳ chọn digest: chỉ tần suất, không trường nào khác. */
export const guardianDigestPreferenceSchema = z.strictObject({
  frequency: guardianDigestFrequencySchema,
});
export type GuardianDigestPreferenceInput = z.infer<typeof guardianDigestPreferenceSchema>;
