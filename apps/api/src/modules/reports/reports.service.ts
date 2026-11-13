import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import { ReportsRepository, type ReportRow, type ScheduleRow } from '@giaokhoa/db/repositories/reports';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { CoursesService } from '../courses/courses.service';
import { MessagingService } from '../messaging/messaging.service';

/** Một dataSource đăng ký: read model theo entity, mỗi dòng kèm courseId để lọc quyền theo context. */
export interface ReportDatasource {
  name: string;
  columns: string[];
  fetchRows(): Promise<Record<string, unknown>[]>;
}
export const REPORT_DATASOURCES = ['enrolments', 'grades', 'completion'] as const;

/**
 * Facade của ReportsModule (Moodle core_reportbuilder, §2#24). Bất biến: quyền xem = audience ∩ quyền trên TỪNG DÒNG theo context của dòng đó. Filter do user cấu hình KHÔNG BAO GIỜ nới quyền — filter chỉ thu hẹp tập dòng đã được phép. Báo cáo theo lịch chạy dưới danh tính người tạo với quyền TẠI THỜI ĐIỂM CHẠY.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly datasources = new Map<string, ReportDatasource>();

  constructor(
    private readonly repo: ReportsRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly courses: CoursesService,
    private readonly messaging: MessagingService,
    private readonly i18n: I18nService,
  ) {
    this.registerBuiltinDatasources();
  }

  /**
   * Cổng metadata báo cáo (H15, rà soát #134 + §7.3): định nghĩa báo cáo, datasource và lịch chạy là thông tin vận hành nội bộ — mọi đường đọc metadata và đường kích hoạt chạy theo lịch đều đòi `reportbuilder:manage` tại system, cùng cổng với createReport/ createSchedule. Dữ liệu báo cáo vẫn gác riêng theo audience + từng dòng ở runReport, không đổi.
   */
  private async requireManage(actorId: string): Promise<void> {
    const sys = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'reportbuilder:manage', sys.id);
  }

  async listDatasources(actorId: string): Promise<{ name: string; columns: string[] }[]> {
    await this.requireManage(actorId);
    return [...this.datasources.values()].map((d) => ({ name: d.name, columns: d.columns }));
  }

  private registerBuiltinDatasources(): void {
    const db = this.repo.dbHandle;
    this.datasources.set('enrolments', {
      name: 'enrolments', columns: ['userId', 'username', 'courseId', 'status'],
      fetchRows: async () => {
        // Nối ở SQL bằng LEFT JOIN (giữ đúng hàng khi enrol/user vắng —
        // username/courseId rơi về ''/0 như phép nối trong bộ nhớ trước đây)
        // thay vì tải toàn bộ ba bảng về rồi nối bằng Map.
        const rows = await db
          .selectFrom('user_enrolments')
          .leftJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
          .leftJoin('users', 'users.id', 'user_enrolments.user_id')
          .select([
            'user_enrolments.user_id as userId', 'user_enrolments.status as status',
            'enrol.course_id as courseId', 'users.username as username',
          ])
          .execute();
        return rows.map((r) => ({
          userId: r.userId, username: r.username ?? '',
          courseId: r.courseId ?? 0, status: r.status,
        }));
      },
    });
    this.datasources.set('grades', {
      name: 'grades', columns: ['userId', 'username', 'courseId', 'itemId', 'finalGrade'],
      fetchRows: async () => {
        // Nối ở SQL bằng LEFT JOIN theo item_id (giữ đúng hàng khi item/user
        // vắng — courseId rơi về 0 như phép nối trong bộ nhớ trước đây).
        const rows = await db
          .selectFrom('grade_grades')
          .leftJoin('grade_items', 'grade_items.id', 'grade_grades.item_id')
          .leftJoin('users', 'users.id', 'grade_grades.user_id')
          .select([
            'grade_grades.user_id as userId', 'grade_grades.item_id as itemId', 'grade_grades.final_grade as finalGrade',
            'grade_items.course_id as courseId', 'users.username as username',
          ])
          .execute();
        return rows.map((r) => ({
          userId: r.userId, username: r.username ?? '',
          courseId: r.courseId ?? 0, itemId: r.itemId, finalGrade: r.finalGrade,
        }));
      },
    });
    this.datasources.set('completion', {
      name: 'completion', columns: ['userId', 'username', 'courseId', 'status', 'cmId', 'completionState'],
      fetchRows: async () => {
        // Nối ở SQL bằng LEFT JOIN (username/courseId vắng rơi về ''/0
        // như phép nối trong bộ nhớ trước đây).
        const courseRows = await db
          .selectFrom('course_completions')
          .leftJoin('users', 'users.id', 'course_completions.user_id')
          .select([
            'course_completions.user_id as userId', 'course_completions.course as courseId',
            'course_completions.status as status', 'users.username as username',
          ])
          .execute();
        const cmRows = await db
          .selectFrom('course_modules_completion')
          .leftJoin('course_modules', 'course_modules.id', 'course_modules_completion.course_module_id')
          .leftJoin('users', 'users.id', 'course_modules_completion.user_id')
          .select([
            'course_modules_completion.user_id as userId',
            'course_modules_completion.course_module_id as courseModuleId',
            'course_modules_completion.completion_state as completionState',
            'course_modules.course as courseId', 'users.username as username',
          ])
          .execute();
        return [
          ...courseRows.map((r) => ({ userId: r.userId, username: r.username ?? '', courseId: r.courseId, status: r.status, cmId: 0, completionState: -1 })),
          ...cmRows.map((r) => ({ userId: r.userId, username: r.username ?? '', courseId: r.courseId ?? 0, status: '', cmId: r.courseModuleId, completionState: r.completionState })),
        ];
      },
    });
  }

  async createReport(actorId: string, input: {
    name: string; dataSource: string; columns?: string[]; filters?: Record<string, unknown>;
    audienceUserIds?: string[]; audienceRoles?: string[];
  }): Promise<ReportRow> {
    const sys = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'reportbuilder:manage', sys.id);
    const ds = this.datasources.get(input.dataSource);
    if (!ds) throw new BadRequestException({ message: `Unknown dataSource ${input.dataSource}`, code: 'report.unknown_datasource' });
    const columns = input.columns?.length ? input.columns : ds.columns;
    for (const c of columns) if (!ds.columns.includes(c)) throw new BadRequestException({ message: `Unknown column ${c}`, code: 'report.unknown_column' });
    const report = await this.repo.insertReport({
      name: input.name, dataSource: input.dataSource, columns, filters: input.filters ?? {}, createdBy: actorId, contextId: sys.id,
    });
    for (const uid of input.audienceUserIds ?? []) await this.repo.insertAudience({ reportId: report.id, userId: uid });
    for (const role of input.audienceRoles ?? []) await this.repo.insertAudience({ reportId: report.id, role });
    // Người tạo luôn thuộc audience của báo cáo của mình.
    if (!(input.audienceUserIds ?? []).includes(actorId)) await this.repo.insertAudience({ reportId: report.id, userId: actorId });
    return report;
  }

  /** Đọc thô một report theo id — đường nội bộ (runReport/createSchedule/worker), không gác tại đây. */
  private async getReportRow(id: string): Promise<ReportRow> {
    const row = await this.repo.getReport(id);
    if (!row) throw new NotFoundException({ message: `Report ${id} not found`, code: 'report.not_found' });
    return row;
  }
  /** Chi tiết report qua HTTP: qua cổng metadata (H15). */
  async getReport(actorId: string, id: string): Promise<ReportRow> {
    await this.requireManage(actorId);
    return this.getReportRow(id);
  }
  async listReports(actorId: string): Promise<ReportRow[]> {
    await this.requireManage(actorId);
    return this.repo.listReports();
  }

  /** Kiểm tra audience: user có trong audience trực tiếp hoặc qua role shortName tại system context. */
  async isInAudience(userId: string, report: ReportRow): Promise<boolean> {
    if (report.createdBy === userId) return true;
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    const audience = await this.repo.listAudience(report.id);
    if (audience.some((a) => a.userId === userId)) return true;
    // Audience theo role: resolve bằng bảng role_assignments (role shortName).
    const roleNames = audience.filter((a) => a.role).map((a) => a.role!);
    if (!roleNames.length) return false;
    // Truy vấn ghép danh sách tên vai trò bằng sql.join nằm ở
    // repository (khuôn T-11 chốt tại issue #648).
    return this.repo.userHasAnyRole(userId, roleNames);
  }

  /**
   * Chạy báo cáo cho một viewer: audience ∩ lọc từng dòng theo quyền.
   * Một dòng course chỉ hiện nếu viewer có course:view ở course
   * context của dòng (hoặc là chính chủ dòng dữ liệu của mình cho grades/
   * enrolments/completion của bản thân — học viên xem được dòng của mình).
   */
  async runReport(viewerId: string, reportId: string): Promise<{ report: ReportRow; rows: Record<string, unknown>[] }> {
    const report = await this.getReportRow(reportId);
    if (!(await this.isInAudience(viewerId, report))) {
      throw new ForbiddenException({ message: 'You are not in the audience of this report', code: 'report.not_in_audience' });
    }
    const ds = this.datasources.get(report.dataSource);
    if (!ds) throw new BadRequestException({ message: 'Datasource no longer registered', code: 'report.datasource_missing' });
    const allRows = await ds.fetchRows();
    const filters = (report.filters ?? {}) as Record<string, unknown>;
    // Filter cấu hình chỉ thu hẹp: áp dụng TRƯỚC lọc quyền cũng không đổi kết quả quyền.
    const filtered = allRows.filter((row) => Object.entries(filters).every(([k, v]) => v === undefined || v === null || row[k] === v));
    const columns = (report.columns as string[]) ?? ds.columns;
    const out: Record<string, unknown>[] = [];
    const ctxCache = new Map<string, string>();
    for (const row of filtered) {
      const courseId = String(row.courseId ?? '');
      let allowed = false;
      if (courseId) {
        if (!ctxCache.has(courseId)) {
          try { ctxCache.set(courseId, await this.courses.courseContextId(courseId)); } catch { ctxCache.set(courseId, ''); }
        }
        const ctxId = ctxCache.get(courseId)!;
        if (ctxId) {
          // Staff có grade:viewall thấy mọi dòng của course; người thường chỉ thấy dòng của chính mình trong course họ được xem.
          allowed = (await this.evaluator.hasCapability(viewerId, 'grade:viewall', ctxId))
            || ((await this.evaluator.hasCapability(viewerId, 'course:view', ctxId)) && String(row.userId) === viewerId);
        }
      } else {
        allowed = String(row.userId) === viewerId;
      }
      if (!allowed) continue;
      const projected: Record<string, unknown> = {};
      for (const c of columns) projected[c] = row[c];
      // Giữ courseId/userId để client và test đối chiếu, kể cả khi không nằm trong columns đã chọn.
      projected.courseId = row.courseId; projected.userId = row.userId;
      out.push(projected);
    }
    return { report, rows: out };
  }

  async createSchedule(actorId: string, reportId: string, cron = 'daily'): Promise<ScheduleRow> {
    const report = await this.getReportRow(reportId);
    const sys = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'reportbuilder:manage', sys.id);
    return this.repo.insertSchedule({ reportId: report.id, createdBy: actorId, cron, enabled: true });
  }
  async listSchedules(actorId: string): Promise<ScheduleRow[]> {
    await this.requireManage(actorId);
    return this.repo.listSchedules();
  }
  /** Kích hoạt chạy một schedule qua HTTP: qua cổng metadata (H15) rồi chạy bằng engine nội bộ. */
  async triggerSchedule(actorId: string, scheduleId: string): Promise<{ scheduleId: string; rows: number }> {
    await this.requireManage(actorId);
    return this.runSchedule(scheduleId);
  }

  /**
   * Chạy một schedule: chạy báo cáo DƯỚI DANH TÍNH NGƯỜI TẠO với quyền tại
   * thời điểm chạy, lưu kết quả vào schedule, và gửi notification qua
   * MessagingModule cho người tạo.
   */
  async runSchedule(scheduleId: string): Promise<{ scheduleId: string; rows: number }> {
    const schedule = await this.repo.getSchedule(scheduleId);
    if (!schedule) throw new NotFoundException({ message: `Schedule ${scheduleId} not found`, code: 'report.schedule_not_found' });
    let rowCount = 0;
    try {
      const { rows } = await this.runReport(schedule.createdBy, schedule.reportId);
      rowCount = rows.length;
      await this.repo.updateSchedule(scheduleId, { lastRun: new Date(), lastResult: { rows: rowCount, ranAs: schedule.createdBy } });
    } catch {
      await this.repo.updateSchedule(scheduleId, { lastRun: new Date(), lastResult: { rows: 0, ranAs: schedule.createdBy, error: 'forbidden_at_run_time' } });
    }
    await this.messaging.notify(schedule.createdBy, 'report_scheduled', {
      subject: this.i18n.t('platform.reportFinishedSubject'), body: this.i18n.t('platform.reportFinishedBody', { args: { reportId: schedule.reportId, rows: rowCount } }), contextUrl: `/reports/${schedule.reportId}`,
    }).catch((err) => {
      // Lỗi phát không bao giờ chặn việc chạy schedule (kết quả đã lưu) —
      // nhưng phải ghi vết để vận hành thấy khi notification hỏng kéo dài.
      this.logger.warn(`Failed to notify report schedule completion (schedule ${scheduleId}, report ${schedule.reportId}, user ${schedule.createdBy}): ${err instanceof Error ? err.message : String(err)}`);
    });
    return { scheduleId, rows: rowCount };
  }
  async runAllSchedules(): Promise<{ ran: number }> {
    const schedules = await this.repo.listSchedules();
    let ran = 0;
    for (const s of schedules) if (s.enabled) { await this.runSchedule(s.id); ran++; }
    return { ran };
  }
}
