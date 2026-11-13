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

/** Trần số việc trong tóm tắt tuần trả về (việc tuần này + quá hạn). */
const WEEKLY_ITEMS_LIMIT = 100;
/** Trần số thông báo lớp trong khối tổng quan. */
const ANNOUNCEMENTS_LIMIT = 20;
/** Số thông báo gần nhất quét để lọc theo khoá (trước khi cắt ANNOUNCEMENTS_LIMIT). */
const ANNOUNCEMENTS_SCAN = 100;
/** Số ngày trong một tuần. */
const DAYS_IN_WEEK = 7;
/** Số mili-giây trong một ngày (tuần tính theo UTC nên không có giờ tiết kiệm ánh sáng). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Bề mặt phụ huynh chỉ-xem (PH-1, issue #130): bốn khối rút gọn của research mục 4.3 + kết quả học tập đã công bố theo môn. Nguyên tắc cứng
 * (mục 5.1) áp ở MỌI đường của service này:
 * - Chỉ-xem: service không có một đường ghi nào ngoài mốc xem của chính
 *   phụ huynh và audit xem (cả hai đều là dữ liệu của phụ huynh, không phải dữ liệu của con).
 * - Chỉ con mình: cổng đầu tiên của mọi hàm là liên kết giám hộ đang hiệu
 *   lực, kiểm tra TRƯỚC mọi truy vấn dữ liệu; thiếu liên kết → 404 đồng nhất qua GuardiansService.requireActiveLinkOr404.
 * - Chỉ dữ liệu đã công bố: khối kết quả mới dùng chung hàm của DASH1
 *   (cổng PH-0); kết quả VN chỉ qua isTermResultPublished /
 *   computeTermResultForGuardian; điểm tổng khoá qua getGradebookForGuardian (đã che phần chưa công bố). Không xếp hạng, không trung bình lớp, không hiện 0 thay cho chưa chấm/chưa tính.
 */
@Injectable()
export class GuardianViewService {
  constructor(
    private readonly repo: GuardianViewRepository,
    private readonly guardians: GuardiansService,
    private readonly dashboard: DashboardService,
    private readonly grades: GradesService,
    private readonly users: UsersService,
  ) {}

  /** Đầu tuần (thứ Hai 00:00 UTC) và cuối tuần (Chủ nhật 23:59:59.999 UTC) chứa `now`. */
  private weekBounds(now: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = start.getUTCDay(); // 0 = Chủ nhật
    // Đổi "thứ trong tuần" sang số ngày đã qua kể từ thứ Hai: thứ Hai → 0, …, Chủ nhật → 6.
    start.setUTCDate(start.getUTCDate() - ((dow + 6) % DAYS_IN_WEEK));
    // Cuối tuần là mili-giây cuối cùng của Chủ nhật.
    const end = new Date(start.getTime() + DAYS_IN_WEEK * MS_PER_DAY - 1);
    return { start, end };
  }

  /** Toàn bộ bề mặt tổng quan của phụ huynh cho một con. */
  async overview(guardianId: string, studentId: string): Promise<GuardianStudentOverviewView> {
    await this.guardians.requireActiveLinkOr404(guardianId, studentId);
    const student = await this.users.getUser(studentId);
    const now = new Date();

    const state = await this.repo.getViewState(guardianId, studentId);
    const previousSeenAt = state?.lastSeenAt ?? null;
    const { courseIds, names } = await this.dashboard.enrolledCoursesFor(studentId);

    // Bốn khối độc lập với nhau (đều chỉ cần courseIds + mốc xem trước) nên chạy song song; thứ tự kết quả giữ nguyên nhờ Promise.all.
    const [weekly, newResults, announcements, courseProgress] = await Promise.all([
      this.buildWeekly(studentId, courseIds, names, now),
      // Lần xem đầu chưa có mốc: không dội toàn bộ kết quả cũ thành "mới".
      previousSeenAt
        ? this.dashboard.publishedNewResultsFor(studentId, previousSeenAt)
        : Promise.resolve([]),
      this.buildAnnouncements(studentId, courseIds, names),
      this.buildProgress(studentId, courseIds, names),
    ]);

    // Mốc chỉ cập nhật SAU khi đã tính xong danh sách mới của lần xem này.
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

  /** Dựng một mục tóm tắt tuần (quiz và assignment cùng hình dạng mục): trạng thái nộp/quá hạn suy từ hạn nộp so với `now`, cờ trong-tuần suy từ hạn nộp so với đầu tuần. */
  private pushWeeklyItem(
    items: (GuardianWeeklyItemView & { inWeek: boolean })[],
    input: { courseId: string; courseName: string; cmId: string; kind: 'quiz' | 'assignment'; name: string; dueAt: Date; submitted: boolean },
    start: Date,
    now: Date,
  ): void {
    items.push({
      courseId: input.courseId,
      courseName: input.courseName,
      cmId: input.cmId,
      kind: input.kind,
      name: input.name,
      dueAt: input.dueAt.toISOString(),
      status: input.submitted ? 'submitted' : input.dueAt < now ? 'overdue' : 'not_submitted',
      inWeek: input.dueAt >= start,
    });
  }

  /** Khối (a): tóm tắt tuần — đã nộp / chưa nộp / quá hạn, cắt theo việc của con. */
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
      this.pushWeeklyItem(items, {
        courseId: entry.courseId,
        courseName: names.get(entry.courseId) ?? '',
        cmId,
        kind: 'quiz',
        name: entry.name,
        dueAt: entry.dueAt,
        submitted: entry.states.some((s) => s === 'finished' || s === 'needsgrading'),
      }, start, now);
    }

    const assignRows = await this.repo.assignmentDueRows(courseIds, studentId, end);
    for (const row of assignRows) {
      this.pushWeeklyItem(items, {
        courseId: row.courseId,
        courseName: names.get(row.courseId) ?? '',
        cmId: row.cmId,
        kind: 'assignment',
        name: row.name,
        dueAt: row.dueAt!,
        submitted: row.submissionStatus === 'submitted',
      }, start, now);
    }

    const dueThisWeek = items.filter((i) => i.inWeek);
    const overdue = items.filter((i) => i.status === 'overdue');
    // Danh sách hiển thị: việc của tuần này + mọi việc quá hạn chưa nộp
    // (quá hạn thuộc tuần này đã nằm trong nhóm tuần — không trùng).
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

  /** Khối (c): thông báo lớp — thông báo đã gửi cho con thuộc các khoá của con, loại thông báo điểm. */
  private async buildAnnouncements(
    studentId: string,
    courseIds: string[],
    names: Map<string, string>,
  ): Promise<GuardianAnnouncementView[]> {
    const rows = await this.repo.recentNotificationsForStudent(studentId, ANNOUNCEMENTS_SCAN);
    const enrolled = new Set(courseIds);
    const out: GuardianAnnouncementView[] = [];
    for (const row of rows) {
      // Thông báo điểm bị loại: dù nội dung không chứa điểm số, sự tồn tại của nó ám chỉ một điểm (có thể chưa công bố) — cổng công bố của PH-0 phải tuyệt đối trên bề mặt phụ huynh.
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

  /** Khối (d): tiến độ % theo khoá của con. */
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

  /** Kết quả học tập ĐÃ CÔNG BỐ của con theo từng khoá/môn. */
  async results(guardianId: string, studentId: string): Promise<GuardianStudentResultsView> {
    await this.guardians.requireActiveLinkOr404(guardianId, studentId);
    const student = await this.users.getUser(studentId);
    const { courseIds, names } = await this.dashboard.enrolledCoursesFor(studentId);

    // Điểm theo từng bài ĐÃ CÔNG BỐ của từng khoá (cổng PH-0 như học sinh tự xem) — mô hình điểm theo bài (issue #224): không còn kết quả kỳ/năm của Sổ điểm VN và không còn điểm tổng khoá. Các khoá độc lập nên nạp song song; Promise.all giữ đúng thứ tự khoá.
    const courses: GuardianCourseResultsView[] = await Promise.all(courseIds.map(async (courseId) => {
      const views = await this.grades.listPublishedActivityGrades(courseId, studentId);
      // TypeScript không thu hẹp `v.grade` qua `.filter` nên giữ `!` ở dưới — mọi phần tử còn lại đã có grade.
      const activities = views
        .filter((v) => v.grade !== null)
        .map((v) => ({
          itemId: v.item.id,
          itemName: v.item.itemName,
          finalGrade: v.grade!.finalGrade,
          gradeMax: v.item.gradeMax,
          feedback: v.grade!.feedback,
        }));
      return {
        courseId,
        courseName: names.get(courseId) ?? '',
        activities,
      };
    }));

    await this.guardians.recordView(guardianId, studentId, 'ph1_results');
    return {
      student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
      courses,
    };
  }
}
