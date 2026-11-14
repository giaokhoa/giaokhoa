import { Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http-errors';
import type {
  CourseCardPrefView,
  DashboardGradingQueueView,
  DashboardNewResultView,
  DashboardOverviewView,
} from '@giaokhoa/contracts';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { GradesService } from '../grades/grades.service';
import { DashboardRepository } from '@giaokhoa/db/repositories/dashboard';

const DUE_ITEMS_LIMIT = 100;

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly grades: GradesService,
  ) {}

  private async teachingCourseIds(userId: string, enrolled: string[], assigned: string[]): Promise<string[]> {
    const candidates = [...new Set([...enrolled, ...assigned])];
    const teaching: string[] = [];
    for (const courseId of candidates) {
      const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, courseId);
      if (!ctx) continue;
      if (await this.evaluator.hasCapability(userId, 'grade:viewall', ctx.id)) teaching.push(courseId);
    }
    return teaching;
  }

  async enrolledCoursesFor(userId: string): Promise<{ courseIds: string[]; names: Map<string, string> }> {
    const courseIds = await this.repo.enrolledCourseIds(userId, new Date());
    const names = await this.repo.courseNames(courseIds);
    return { courseIds, names };
  }

  async publishedNewResultsFor(userId: string, since: Date): Promise<DashboardNewResultView[]> {
    const { courseIds, names } = await this.enrolledCoursesFor(userId);
    return this.buildNewResults(userId, courseIds, names, since);
  }

  async getOverview(userId: string, days: number): Promise<DashboardOverviewView> {
    const now = new Date();
    const state = await this.repo.getState(userId);
    const previousSeenAt = state?.lastSeenAt ?? null;
    const since = previousSeenAt ?? now;

    const enrolled = await this.repo.enrolledCourseIds(userId, now);
    const assigned = await this.repo.roleAssignedCourseIds(userId);
    const teaching = await this.teachingCourseIds(userId, enrolled, assigned);
    const names = await this.repo.courseNames([...new Set([...enrolled, ...teaching])]);

    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const dueItems = await this.buildDueItems(userId, enrolled, names, until, now);
    const newResults = previousSeenAt
      ? await this.buildNewResults(userId, enrolled, names, since)
      : [];
    const gradingQueue = await this.buildGradingQueue(teaching, names);

    await this.repo.touchState(userId, now);

    return {
      generatedAt: now.toISOString(),
      previousSeenAt: previousSeenAt?.toISOString() ?? null,
      dueItems,
      newResults,
      gradingQueue,
    };
  }

  private async buildDueItems(
    userId: string,
    enrolled: string[],
    names: Map<string, string>,
    until: Date,
    now: Date,
  ): Promise<DashboardOverviewView['dueItems']> {
    const items: DashboardOverviewView['dueItems'] = [];

    const quizRows = await this.repo.quizDueRows(enrolled, userId, until);
    const quizByCm = new Map<string, { courseId: string; activityId: string; name: string; dueAt: Date; states: (string | null)[] }>();
    for (const row of quizRows) {
      const entry = quizByCm.get(row.cmId) ?? { courseId: row.courseId, activityId: row.activityId!, name: row.name, dueAt: row.dueAt!, states: [] };
      entry.states.push(row.attemptState);
      quizByCm.set(row.cmId, entry);
    }
    for (const [cmId, entry] of quizByCm) {
      if (entry.states.some((s) => s === 'finished' || s === 'needsgrading')) continue;
      const inProgress = entry.states.some((s) => s === 'inprogress');
      items.push({
        courseId: entry.courseId,
        courseName: names.get(entry.courseId) ?? '',
        cmId,
        activityId: entry.activityId,
        kind: 'quiz',
        name: entry.name,
        dueAt: entry.dueAt.toISOString(),
        status: entry.dueAt < now ? 'overdue' : inProgress ? 'in_progress' : 'not_started',
      });
    }

    const assignRows = await this.repo.assignmentDueRows(enrolled, userId, until);
    for (const row of assignRows) {
      if (row.submissionStatus === 'submitted') continue;
      items.push({
        courseId: row.courseId,
        courseName: names.get(row.courseId) ?? '',
        cmId: row.cmId,
        activityId: row.activityId!,
        kind: 'assignment',
        name: row.name,
        dueAt: row.dueAt!.toISOString(),
        status: row.dueAt! < now ? 'overdue' : row.submissionStatus === 'draft' ? 'in_progress' : 'not_started',
      });
    }

    items.sort((a, b) => {
      const groupA = a.status === 'overdue' ? 0 : 1;
      const groupB = b.status === 'overdue' ? 0 : 1;
      if (groupA !== groupB) return groupA - groupB;
      return a.dueAt.localeCompare(b.dueAt);
    });
    return items.slice(0, DUE_ITEMS_LIMIT);
  }

  private async buildNewResults(
    userId: string,
    enrolled: string[],
    names: Map<string, string>,
    since: Date,
  ): Promise<DashboardNewResultView[]> {
    const results: DashboardNewResultView[] = [];

    const itemPubs = await this.repo.itemPublications(enrolled);
    const latestPubByItem = new Map<string, (typeof itemPubs)[number]>();
    for (const p of itemPubs) {
      if (p.itemId) latestPubByItem.set(p.itemId, p);
    }
    const publishedAfterSince = new Set<string>();
    for (const [itemId, p] of latestPubByItem) {
      if (p.action === 'publish' && p.createdAt > since) publishedAfterSince.add(itemId);
    }

    type GradeRow = Awaited<ReturnType<DashboardRepository['gradeRowsSince']>>[number];
    const candidateByGradeId = new Map<string, GradeRow>();
    for (const row of await this.repo.gradeRowsSince(enrolled, userId, since)) {
      candidateByGradeId.set(row.gradeId, row);
    }
    for (const row of await this.repo.gradeRowsForItems([...publishedAfterSince], userId)) {
      candidateByGradeId.set(row.gradeId, row);
    }

    const rowsByCourse = new Map<string, GradeRow[]>();
    for (const row of candidateByGradeId.values()) {
      if (row.itemType !== 'mod' && row.itemType !== 'manual') continue;
      const list = rowsByCourse.get(row.courseId) ?? [];
      list.push(row);
      rowsByCourse.set(row.courseId, list);
    }
    for (const [courseId, rows] of rowsByCourse) {
      const states = await this.grades.publicationStatesForCourse(courseId);
      for (const row of rows) {
        if (!(states.get(row.itemId)?.published ?? true)) continue;
        const pub = latestPubByItem.get(row.itemId);
        const effectiveAt = pub && pub.action === 'publish' && pub.createdAt > row.updatedAt
          ? pub.createdAt
          : row.updatedAt;
        if (effectiveAt <= since) continue;
        results.push({
          courseId,
          courseName: names.get(courseId) ?? '',
          kind: 'grade_item',
          itemId: row.itemId,
          itemName: row.itemName,
          finalGrade: row.finalGrade,
          gradeMax: row.gradeMax,
          feedback: row.feedback,
          changedAt: effectiveAt.toISOString(),
        });
      }
    }

    results.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    return results;
  }

  private async buildGradingQueue(
    teaching: string[],
    names: Map<string, string>,
  ): Promise<DashboardGradingQueueView[]> {
    if (!teaching.length) return [];
    const byCourse = new Map<string, DashboardGradingQueueView & { oldest: Date | null; paperOldest: Date | null }>();
    const entryFor = (courseId: string) => {
      const entry = byCourse.get(courseId) ?? {
        courseId,
        courseName: names.get(courseId) ?? '',
        pendingCount: 0,
        assignmentPending: 0,
        quizPending: 0,
        paperPending: 0,
        paperPinId: null,
        oldestPendingAt: null,
        oldest: null,
        paperOldest: null,
      };
      byCourse.set(courseId, entry);
      return entry;
    };

    for (const row of await this.repo.assignmentPendingRows(teaching)) {
      if (row.gradeStatus === 'released') continue;
      const entry = entryFor(row.courseId);
      entry.assignmentPending += 1;
      entry.pendingCount += 1;
      if (row.submittedAt && (!entry.oldest || row.submittedAt < entry.oldest)) entry.oldest = row.submittedAt;
    }
    for (const row of await this.repo.quizPendingRows(teaching)) {
      const entry = entryFor(row.courseId);
      entry.quizPending += 1;
      entry.pendingCount += 1;
      const at = row.timeFinish ?? row.timeStart;
      if (!entry.oldest || at < entry.oldest) entry.oldest = at;
    }
    for (const row of await this.repo.paperPendingRows(teaching)) {
      const entry = entryFor(row.courseId);
      entry.paperPending += 1;
      entry.pendingCount += 1;
      if (!entry.oldest || row.createdAt < entry.oldest) entry.oldest = row.createdAt;
      if (!entry.paperOldest || row.createdAt < entry.paperOldest) {
        entry.paperOldest = row.createdAt;
        entry.paperPinId = row.pinId;
      }
    }

    return [...byCourse.values()]
      .filter((e) => e.pendingCount > 0)
      .map((e) => ({
        courseId: e.courseId,
        courseName: e.courseName,
        pendingCount: e.pendingCount,
        assignmentPending: e.assignmentPending,
        quizPending: e.quizPending,
        paperPending: e.paperPending,
        paperPinId: e.paperPinId,
        oldestPendingAt: e.oldest?.toISOString() ?? null,
      }))
      .sort((a, b) => (a.oldestPendingAt ?? '').localeCompare(b.oldestPendingAt ?? ''));
  }

  async listCourseCards(userId: string): Promise<CourseCardPrefView[]> {
    const rows = await this.repo.listPrefs(userId);
    return rows.map((r) => ({
      courseId: r.courseId,
      color: (r.color as CourseCardPrefView['color']) ?? null,
      nickname: r.nickname,
    }));
  }

  async upsertCourseCard(
    userId: string,
    courseId: string,
    input: { color?: string | null; nickname?: string | null },
  ): Promise<CourseCardPrefView> {
    await this.assertBelongsToCourse(userId, courseId);
    const color = input.color ?? null;
    const nickname = input.nickname?.trim() ? input.nickname.trim() : null;
    if (color === null && nickname === null) {
      await this.repo.deletePref(userId, courseId);
      return { courseId, color: null, nickname: null };
    }
    const row = await this.repo.upsertPref(userId, courseId, color, nickname);
    return {
      courseId: row.courseId,
      color: (row.color as CourseCardPrefView['color']) ?? null,
      nickname: row.nickname,
    };
  }

  private async assertBelongsToCourse(userId: string, courseId: string): Promise<void> {
    const now = new Date();
    const enrolled = await this.repo.enrolledCourseIds(userId, now);
    if (enrolled.includes(courseId)) return;
    const assigned = await this.repo.roleAssignedCourseIds(userId);
    if (assigned.includes(courseId)) {
      const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, courseId);
      if (ctx && await this.evaluator.hasCapability(userId, 'grade:viewall', ctx.id)) return;
    }
    forbidden('User does not belong to this course', 'dashboard.course_not_accessible');
  }
}
