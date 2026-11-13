import { z } from 'zod';
import type { DashboardNewResultView } from './dashboard.js';


export interface GuardianWeeklyItemView {
  courseId: string;
  courseName: string;
  cmId: string;
  kind: 'quiz' | 'assignment';
  name: string;
  dueAt: string;
  status: 'submitted' | 'not_submitted' | 'overdue';
}

export interface GuardianWeeklySummaryView {
  weekStart: string;
  weekEnd: string;
  dueThisWeek: number;
  submitted: number;
  notSubmitted: number;
  overdue: number;
  items: GuardianWeeklyItemView[];
}

export interface GuardianAnnouncementView {
  id: string;
  courseId: string;
  courseName: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface GuardianCourseProgressView {
  courseId: string;
  courseName: string;
  total: number;
  completed: number;
  percent: number | null;
}

export interface GuardianStudentOverviewView {
  student: { id: string; firstName: string; lastName: string };
  generatedAt: string;
  previousSeenAt: string | null;
  weekly: GuardianWeeklySummaryView;
  newResults: DashboardNewResultView[];
  announcements: GuardianAnnouncementView[];
  courseProgress: GuardianCourseProgressView[];
}

export interface GuardianActivityResultView {
  itemId: string;
  itemName: string;
  finalGrade: number | null;
  gradeMax: number;
  feedback: string | null;
}

export interface GuardianCourseResultsView {
  courseId: string;
  courseName: string;
  activities: GuardianActivityResultView[];
}

export interface GuardianStudentResultsView {
  student: { id: string; firstName: string; lastName: string };
  courses: GuardianCourseResultsView[];
}

export type GuardianDigestFrequency = 'weekly' | 'daily' | 'off';

export interface GuardianDigestPreferenceView {
  studentId: string;
  frequency: GuardianDigestFrequency;
}

export const guardianDigestPreferenceSchema = z.strictObject({
  frequency: z.enum(['weekly', 'daily', 'off']),
});
export type GuardianDigestPreferenceInput = z.infer<typeof guardianDigestPreferenceSchema>;
