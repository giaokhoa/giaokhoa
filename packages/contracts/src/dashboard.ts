import { z } from 'zod';
import { uuidIdSchema } from './ids.js';

/**
 * Contracts của Dashboard việc cần làm (DASH1, issue #121 — Đợt 6):
 * endpoint tổng hợp cho khối đầu dashboard + tuỳ chọn thẻ khoá cá nhân. Mọi mốc thời gian trong schema route đều là chuỗi ISO (`z.iso.datetime`) — không dùng `z.date()`/`z.coerce.date()` (sẽ làm Swagger createDocument chết lúc boot production).
 */

/** Bảng màu cố định cho thẻ khoá — token màu, không nhận CSS tự do. */
export const COURSE_CARD_COLORS = [
  'red', 'orange', 'amber', 'green', 'teal',
  'blue', 'indigo', 'violet', 'pink', 'slate',
] as const;
export type CourseCardColor = (typeof COURSE_CARD_COLORS)[number];

/** Cửa sổ hạn nộp mặc định của khối việc cần làm (ngày). */
export const DASHBOARD_DUE_WINDOW_DAYS = 7;

/** Query của GET /dashboard/overview — cửa sổ hạn nộp là tham số rõ ràng. */
export const dashboardOverviewQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(30).default(DASHBOARD_DUE_WINDOW_DAYS),
});
export type DashboardOverviewQuery = z.infer<typeof dashboardOverviewQuerySchema>;

/** Body của PUT /dashboard/course-cards/:courseId — null = xoá giá trị đó. */
export const upsertCourseCardPrefSchema = z.strictObject({
  color: z.enum(COURSE_CARD_COLORS).nullable().optional(),
  nickname: z.string().trim().max(60).nullable().optional(),
});
export type UpsertCourseCardPref = z.infer<typeof upsertCourseCardPrefSchema>;

/** Một việc sắp đến hạn của học sinh trong khối tổng hợp. */
export const dashboardDueItemViewSchema = z.strictObject({
  courseId: z.string(),
  courseName: z.string(),
  cmId: z.string(),
  /** Id của instance hoạt động (quiz id / assignment id) — đích của liên kết "làm ngay" (ĐX-5). */
  activityId: z.string(),
  /** quiz | assignment. */
  kind: z.enum(['quiz', 'assignment']),
  name: z.string(),
  /** Hạn nộp (ISO). */
  dueAt: z.iso.datetime(),
  status: z.enum(['not_started', 'in_progress', 'overdue']),
});
export type DashboardDueItemView = z.infer<typeof dashboardDueItemViewSchema>;

/** Một kết quả ĐÃ CÔNG BỐ mới kể từ mốc xem trước của học sinh. */
export const dashboardNewResultViewSchema = z.strictObject({
  courseId: z.string(),
  courseName: z.string(),
  /** grade_item: điểm/phản hồi của một bài (grade item) đã công bố. */
  kind: z.literal('grade_item'),
  /** Chỉ có ở kind grade_item. */
  itemId: z.string().nullable(),
  itemName: z.string().nullable(),
  finalGrade: z.number().nullable(),
  gradeMax: z.number().nullable(),
  feedback: z.string().nullable(),
  /** Mốc thay đổi/công bố (ISO). */
  changedAt: z.iso.datetime(),
});
export type DashboardNewResultView = z.infer<typeof dashboardNewResultViewSchema>;

/** Một hàng trong hàng đợi chấm của giáo viên (gộp theo khoá). */
export const dashboardGradingQueueViewSchema = z.strictObject({
  courseId: z.string(),
  courseName: z.string(),
  /** Tổng việc chờ của khoá = bài nộp + lượt quiz chờ chấm tay + phiếu giấy chờ (ba trường *Pending tách bạch từng loại). */
  pendingCount: z.number(),
  assignmentPending: z.number(),
  quizPending: z.number(),
  /**
   * Phiếu giấy CAM-0 đang chờ xử lý của khoá (trạng thái needs_review + needs_identity) — đếm tách bạch với bài nộp/lượt quiz, KHÔNG gộp vào assignmentPending/quizPending (nối DASH1 ← CAM-0, issue #187).
   */
  paperPending: z.number(),
  /**
   * Quiz có phiếu giấy chờ LÂU NHẤT của khoá — đích deep-link tới bề mặt rà soát CAM (/courses/:courseId/exams/:paperPinId/paper); null khi paperPending = 0.
   */
  paperPinId: z.string().nullable(),
  /** Bài chờ lâu nhất (ISO, tính cả phiếu giấy); null khi hàng đợi rỗng. */
  oldestPendingAt: z.iso.datetime().nullable(),
});
export type DashboardGradingQueueView = z.infer<typeof dashboardGradingQueueViewSchema>;

/** Toàn bộ khối đầu dashboard trong MỘT response. */
export const dashboardOverviewViewSchema = z.strictObject({
  /** Thời điểm server tính khối này (ISO) — client neo hiển thị theo mốc này. */
  generatedAt: z.iso.datetime(),
  /** Mốc xem trước đã dùng để tính newResults (ISO); null ở lần xem đầu. */
  previousSeenAt: z.iso.datetime().nullable(),
  dueItems: z.array(dashboardDueItemViewSchema),
  newResults: z.array(dashboardNewResultViewSchema),
  gradingQueue: z.array(dashboardGradingQueueViewSchema),
});
export type DashboardOverviewView = z.infer<typeof dashboardOverviewViewSchema>;

/** Tuỳ chọn thẻ khoá của chính người dùng cho một khoá. */
export const courseCardPrefViewSchema = z.strictObject({
  courseId: z.string(),
  color: z.enum(COURSE_CARD_COLORS).nullable(),
  nickname: z.string().nullable(),
});
export type CourseCardPrefView = z.infer<typeof courseCardPrefViewSchema>;

export const courseCardPrefParamsSchema = z.strictObject({ courseId: uuidIdSchema });
