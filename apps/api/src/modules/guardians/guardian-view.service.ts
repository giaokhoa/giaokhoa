import { Injectable } from '@nestjs/common';
import type {
  GuardianAnnouncementView,
  GuardianCourseProgressView,
  GuardianCourseResultsView,
  GuardianStudentOverviewView,
  GuardianStudentResultsView,
  GuardianWeeklyItemView,
} from '@giaokhoa/contracts';
import { DashboardService } from '../dashboard/dashboard.service';
import { GradesService } from '../grades/grades.service';
import { UsersService } from '../users/users.service';
import { GuardianViewRepository } from '@giaokhoa/db/repositories/guardian-view';
import { GuardiansService } from './guardians.service';

const WEEKLY_ITEMS_LIMIT = 100;
const ANNOUNCEMENTS_LIMIT = 20;
const ANNOUNCEMENTS_SCAN = 100;

@Injectable()
export class GuardianViewService {
  constructor(
    private readonly repo: GuardianViewRepository,
    private readonly guardians: GuardiansService,
    private readonly dashboard: DashboardService,
    private readonly grades: GradesService,
    private readonly users: UsersService,
  ) {}

  private weekBounds(now: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - ((dow + 6) % 7));
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }

  async overview(guardianId: string, studentId: string): Promise<GuardianStudentOverviewView> {
    await this.guardians.requireActiveLinkOr404(guardianId, studentId);
    const student = await this.users.getUser(studentId);
    const now = new Date();

    const state = await this.repo.getViewState(guardianId, studentId);
    const previousSeenAt = state?.lastSeenAt ?? null;
    const { courseIds, names } = await this.dashboard.enrolledCoursesFor(studentId);

    const weekly = await this.buildWeekly(studentId, courseIds, names, now);
    const newResults = previousSeenAt
      ? await this.dashboard.publishedNewResultsFor(studentId, previousSeenAt)
      : [];
    const announcements = await this.buildAnnouncements(studentId, courseIds, names);
    const courseProgress = await this.buildProgress(studentId, courseIds, names);

    await this.repo.touchViewState(guardianId, studentId, now);
    await this.guardians.recordView(guardianId, studentId, 'ph1_overview');

    return {
      student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
      generatedAt: now.toISOString(),
      previousSeenAt: previousSeenAt?.toISOString() ?? null,
      weekly,
      newResults,
      announcements,
      courseProgress,
    };
  }

  private async buildWeekly(
    studentId: string,
    courseIds: string[],
    names: Map<string, string>,
    now: Date,
  ): Promise<GuardianStudentOverviewView['weekly']> {
    const { start, end } = this.weekBounds(now);
    type Item = GuardianWeeklyItemView & { inWeek: boolean };
    const items: Item[] = [];

    const quizRows = await this.repo.quizDueRows(courseIds, studentId, end);
    const quizByCm = new Map<string, { courseId: string; name: string; dueAt: Date; states: (string | null)[] }>();
    for (const row of quizRows) {
      const entry = quizByCm.get(row.cmId) ?? { courseId: row.courseId, name: row.name, dueAt: row.dueAt!, states: [] };
      entry.states.push(row.attemptState);
      quizByCm.set(row.cmId, entry);
    }
    for (const [cmId, entry] of quizByCm) {
      const submitted = entry.states.some((s) => s === 'finished' || s === 'needsgrading');
      items.push({
        courseId: entry.courseId,
        courseName: names.get(entry.courseId) ?? '',
        cmId,
        kind: 'quiz',
        name: entry.name,
        dueAt: entry.dueAt.toISOString(),
        status: submitted ? 'submitted' : entry.dueAt < now ? 'overdue' : 'not_submitted',
        inWeek: entry.dueAt >= start,
      });
    }

    const assignRows = await this.repo.assignmentDueRows(courseIds, studentId, end);
    for (const row of assignRows) {
      const submitted = row.submissionStatus === 'submitted';
      items.push({
        courseId: row.courseId,
        courseName: names.get(row.courseId) ?? '',
        cmId: row.cmId,
        kind: 'assignment',
        name: row.name,
        dueAt: row.dueAt!.toISOString(),
        status: submitted ? 'submitted' : row.dueAt! < now ? 'overdue' : 'not_submitted',
        inWeek: row.dueAt! >= start,
      });
    }

    const dueThisWeek = items.filter((i) => i.inWeek);
    const overdue = items.filter((i) => i.status === 'overdue');
    const listed = [...dueThisWeek, ...overdue.filter((i) => !i.inWeek)];
    listed.sort((a, b) => {
      const groupA = a.status === 'overdue' ? 0 : 1;
      const groupB = b.status === 'overdue' ? 0 : 1;
      if (groupA !== groupB) return groupA - groupB;
      return a.dueAt.localeCompare(b.dueAt);
    });

    return {
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      dueThisWeek: dueThisWeek.length,
      submitted: dueThisWeek.filter((i) => i.status === 'submitted').length,
      notSubmitted: dueThisWeek.filter((i) => i.status === 'not_submitted').length,
      overdue: overdue.length,
      items: listed.slice(0, WEEKLY_ITEMS_LIMIT).map(({ inWeek: _inWeek, ...item }) => item),
    };
  }

  private async buildAnnouncements(
    studentId: string,
    courseIds: string[],
    names: Map<string, string>,
  ): Promise<GuardianAnnouncementView[]> {
    const rows = await this.repo.recentNotificationsForStudent(studentId, ANNOUNCEMENTS_SCAN);
    const enrolled = new Set(courseIds);
    const out: GuardianAnnouncementView[] = [];
    for (const row of rows) {
      if (row.eventType === 'grade_updated') continue;
      const match = row.contextUrl?.match(/^\/courses\/([0-9a-fA-F-]{36})(?:\/|$)/);
      if (!match) continue;
      const courseId = match[1]!;
      if (!enrolled.has(courseId)) continue;
      out.push({
        id: row.id,
        courseId,
        courseName: names.get(courseId) ?? '',
        subject: row.subject,
        body: row.fullMessage,
        createdAt: row.createdAt.toISOString(),
      });
      if (out.length >= ANNOUNCEMENTS_LIMIT) break;
    }
    return out;
  }

  private async buildProgress(
    studentId: string,
    courseIds: string[],
    names: Map<string, string>,
  ): Promise<GuardianCourseProgressView[]> {
    const rows = await this.repo.courseProgressRows(courseIds, studentId);
    const byCourse = new Map(rows.map((r) => [r.courseId, r]));
    return courseIds.map((courseId) => {
      const row = byCourse.get(courseId);
      const total = row?.total ?? 0;
      const completed = row?.completed ?? 0;
      return {
        courseId,
        courseName: names.get(courseId) ?? '',
        total,
        completed,
        percent: total ? Math.round((completed / total) * 100) : null,
      };
    });
  }

  async results(guardianId: string, studentId: string): Promise<GuardianStudentResultsView> {
    await this.guardians.requireActiveLinkOr404(guardianId, studentId);
    const student = await this.users.getUser(studentId);
    const { courseIds, names } = await this.dashboard.enrolledCoursesFor(studentId);

    const courses: GuardianCourseResultsView[] = [];
    for (const courseId of courseIds) {
      const views = await this.grades.listPublishedActivityGrades(courseId, studentId);
      const activities = views
        .filter((v) => v.grade !== null)
        .map((v) => ({
          itemId: v.item.id,
          itemName: v.item.itemName,
          finalGrade: v.grade!.finalGrade,
          gradeMax: v.item.gradeMax,
          feedback: v.grade!.feedback,
        }));
      courses.push({
        courseId,
        courseName: names.get(courseId) ?? '',
        activities,
      });
    }

    await this.guardians.recordView(guardianId, studentId, 'ph1_results');
    return {
      student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
      courses,
    };
  }
}
