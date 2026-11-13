import { z } from 'zod';
import { uuidIdSchema } from './ids.js';


export const COURSE_CARD_COLORS = [
  'red', 'orange', 'amber', 'green', 'teal',
  'blue', 'indigo', 'violet', 'pink', 'slate',
] as const;
export type CourseCardColor = (typeof COURSE_CARD_COLORS)[number];

export const DASHBOARD_DUE_WINDOW_DAYS = 7;

export const dashboardOverviewQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(30).default(DASHBOARD_DUE_WINDOW_DAYS),
});
export type DashboardOverviewQuery = z.infer<typeof dashboardOverviewQuerySchema>;

export const upsertCourseCardPrefSchema = z.strictObject({
  color: z.enum(COURSE_CARD_COLORS).nullable().optional(),
  nickname: z.string().trim().max(60).nullable().optional(),
});
export type UpsertCourseCardPref = z.infer<typeof upsertCourseCardPrefSchema>;

export interface DashboardDueItemView {
  courseId: string;
  courseName: string;
  cmId: string;
  activityId: string;
  kind: 'quiz' | 'assignment';
  name: string;
  dueAt: string;
  status: 'not_started' | 'in_progress' | 'overdue';
}

export interface DashboardNewResultView {
  courseId: string;
  courseName: string;
  kind: 'grade_item';
  itemId: string | null;
  itemName: string | null;
  finalGrade: number | null;
  gradeMax: number | null;
  feedback: string | null;
  changedAt: string;
}

export interface DashboardGradingQueueView {
  courseId: string;
  courseName: string;
  pendingCount: number;
  assignmentPending: number;
  quizPending: number;
  paperPending: number;
  paperPinId: string | null;
  oldestPendingAt: string | null;
}

export interface DashboardOverviewView {
  generatedAt: string;
  previousSeenAt: string | null;
  dueItems: DashboardDueItemView[];
  newResults: DashboardNewResultView[];
  gradingQueue: DashboardGradingQueueView[];
}

export interface CourseCardPrefView {
  courseId: string;
  color: CourseCardColor | null;
  nickname: string | null;
}

export const courseCardPrefParamsSchema = z.strictObject({ courseId: uuidIdSchema });
