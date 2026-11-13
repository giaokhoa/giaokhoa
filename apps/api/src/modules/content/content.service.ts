import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ContentRepository, type PageRow, type ResourceRow } from '@giaokhoa/db/repositories/content';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import {
  COMPLETION_COMPLETE, COMPLETION_INCOMPLETE, CompletionService,
} from '../completion/completion.service';
import { CoursesService } from '../courses/courses.service';
import type { CmRow } from '@giaokhoa/db/repositories/courses';
import { FilesService } from '../files/files.service';
import { isSafeExternalResourceUrl, sanitizePageContent } from './page-content-sanitizer';

export const PAGE_COMPONENT = 'mod_page';
export const RESOURCE_COMPONENT = 'mod_resource';

/** Ngưỡng hoàn thành mặc định cho video (chế độ progress): xem ≥ 90% thời lượng thì hoàn thành — theo nghiên cứu học liệu số VN (K2-B1); điểm cấu hình duy nhất, đổi tại đây khi có site-config cho ngưỡng này. */
export const VIDEO_COMPLETION_THRESHOLD_PERCENT = 90;

/** Chế độ theo dõi hoàn thành của course module theo Moodle (cột `completion` của cm): 0 = không theo dõi, 1 = thủ công, 2 = tự động. Khác với TRẠNG THÁI hoàn thành (0 chưa xong / 1 đã xong) ở bảng `course_modules_completion` — xem COMPLETION_INCOMPLETE/COMPLETION_COMPLETE của CompletionService. */
export const COMPLETION_TRACKING_NONE = 0;
export const COMPLETION_TRACKING_MANUAL = 1;
export const COMPLETION_TRACKING_AUTO = 2;

/** Ngưỡng đồng thuận của mốc lớp: một cm được tính là "lớp đã học tới đây" khi ít nhất một nửa thành viên lớp đã hoàn thành cm đó (và mọi cm trước nó trong outline). */
export const CLASS_MARKER_QUORUM = 0.5;

type CompletionMode = 'view' | 'manual' | 'progress' | 'none';

/** Ánh xạ chế độ hoàn thành của mục nội dung sang các trường completion của course module. */
function completionFields(mode: CompletionMode): { completion: number; completionView: boolean; completionManual: boolean; completionUseGrade: boolean } {
  if (mode === 'view') return { completion: COMPLETION_TRACKING_AUTO, completionView: true, completionManual: false, completionUseGrade: false };
  if (mode === 'manual') return { completion: COMPLETION_TRACKING_MANUAL, completionView: false, completionManual: true, completionUseGrade: false };
  // progress: completion tự động nhưng không tiêu chí sẵn nào của engine áp được — trạng thái lưu trong bản ghi completion là nguồn quyết định (computeCmState trả về trạng thái đã lưu khi không có tiêu chí view/expected/grade), ContentService ghi trạng thái hoàn thành khi % xem đạt ngưỡng, cùng khuôn với refreshGradeCompletion của Grades.
  if (mode === 'progress') return { completion: COMPLETION_TRACKING_AUTO, completionView: false, completionManual: false, completionUseGrade: false };
  return { completion: COMPLETION_TRACKING_NONE, completionView: false, completionManual: false, completionUseGrade: false };
}

/** Suy chế độ hoàn thành từ các trường của course module (đảo ngược completionFields). */
function modeOfCm(cm: CmRow): CompletionMode {
  if (cm.completion === COMPLETION_TRACKING_NONE) return 'none';
  if (cm.completionView) return 'view';
  if (cm.completionManual || cm.completion === COMPLETION_TRACKING_MANUAL) return 'manual';
  return 'progress';
}

/**
 * Mặc định hoàn thành theo LOẠI nội dung (bảng 2.1 của nghiên cứu học liệu số VN): video → progress (xem ≥ ngưỡng); tài liệu đọc (PDF/văn bản/trình chiếu) → manual (mở xem + tự xác nhận); tệp còn lại (tải về/mô phỏng) và liên kết ngoài → none (chỉ ghi truy cập, ngoài % hoàn thành). Giáo viên đổi được theo từng mục khi tạo/sửa.
 */
function defaultModeForFile(mimeType: string | null): CompletionMode {
  if (mimeType?.startsWith('video/')) return 'progress';
  if (
    mimeType === 'application/pdf'
    || mimeType?.startsWith('text/')
    || mimeType?.includes('presentation')
    || mimeType?.includes('word')
    || mimeType?.includes('spreadsheet')
  ) return 'manual';
  return 'none';
}

/** URL nhúng cho video/liên kết ngoài (YouTube/Vimeo) — null nếu không nhúng được. */
export function embedUrlFor(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

export interface OutlineItemProgress {
  cmId: string; name: string; component: string; instanceId: string | null;
  completion: number; state: number; viewed: boolean; done: boolean;
}
export interface SectionProgress {
  sectionId: string; name: string | null; section: number;
  total: number; completed: number; percent: number | null;
  items: OutlineItemProgress[];
}
export interface MyProgress {
  courseId: string;
  total: number; completed: number; percent: number | null;
  sections: SectionProgress[];
  lastAccess: { cmId: string; at: string } | null;
  resume: { cmId: string; reason: 'last_access' | 'next_incomplete' | 'all_done' | 'start' } | null;
}
export interface ClassMarker {
  scope: 'group' | 'course';
  groupId: string | null; groupName: string;
  memberCount: number;
  markerCmId: string | null; markerName: string | null; markerIndex: number;
  percent: number | null;
}

/** Tệp đính kèm của một tài nguyên kèm URL đã ký để xem/tải. */
export interface SignedFileView {
  id: string; fileName: string; mimeType: string | null; fileSize: number; signedUrl: string; signedUrlExpiresAt: number;
}

/** Một học sinh trong báo cáo tiến độ của giáo viên (một hàng của ma trận lớp × mục). */
export interface ProgressReportStudent {
  userId: string; username: string; fullName: string;
  completed: number; total: number; percent: number | null;
  lastAccessAt: string | null;
  states: Record<string, number>;
  records: { cmId: string; cmName: string; completedAt: string }[];
}

@Injectable()
/**
 * Học liệu trong khoá (K2): trang đọc mod_page, tài nguyên mod_resource
 * (tệp/liên kết/video), trang học (player), tổng hợp tiến độ học từ dữ
 * liệu completion và mốc tiến độ theo lớp (nhóm) trên outline.
 */
export class ContentService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly courses: CoursesService,
    private readonly completion: CompletionService,
    private readonly files: FilesService,
    private readonly evaluator: PermissionEvaluator,
  ) {
    // Hồ sơ quá trình học (Điều 8 TT 09/2021): mọi lần một cm chuyển sang hoàn thành (bất kỳ đường nào — xem/thủ công/điểm/tiến độ) đều được chụp lại tên mục tại thời điểm đó vào learning_records.
    this.completion.registerCmCompletionHook(async ({ cmId, courseId, userId }) => {
      const cm = await this.courses.getCm(cmId).catch(() => undefined);
      await this.repo.insertLearningRecord({
        userId, courseId, cmId,
        cmName: cm?.name ?? '', component: cm?.component ?? '',
      });
    });
  }

  /**
   * Tạo một bản ghi nội dung kèm course module của nó (khung chung của createPage/createResource): ghi bản ghi với cmId null → tạo cm → gắn cmId vào bản ghi. Tạo cm lỗi thì xoá bản ghi vừa tạo để không còn bản ghi mồ côi, rồi ném lại lỗi gốc.
   */
  private async createWithCm<T extends { id: string }>(args: {
    actorId: string; courseId: string; sectionId: string; component: string; name: string; mode: CompletionMode;
    insert: () => Promise<T>;
    attachCmId: (id: string, cmId: string) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  }): Promise<T> {
    const record = await args.insert();
    try {
      const cm = await this.courses.createCm(args.actorId, args.courseId, {
        sectionId: args.sectionId, component: args.component, instanceId: record.id, name: args.name,
        ...completionFields(args.mode),
      });
      await args.attachCmId(record.id, cm.id);
    } catch (err) {
      await args.remove(record.id).catch(() => undefined);
      throw err;
    }
    return record;
  }

  /**
   * Đồng bộ tên/chế độ hoàn thành của một bản ghi nội dung sang course module của nó (khung chung của updatePage/updateResource): chỉ gọi updateCm khi có cm và có trường cần đồng bộ.
   */
  private async syncNameAndModeToCm(
    actorId: string, cmId: string | null, input: { name?: string; completionMode?: CompletionMode },
  ): Promise<void> {
    if (!cmId || (input.name === undefined && input.completionMode === undefined)) return;
    await this.courses.updateCm(actorId, cmId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.completionMode !== undefined ? completionFields(input.completionMode) : {}),
    });
  }

  /**
   * Các course module có bật theo dõi hoàn thành của một khoá, xếp theo thứ tự section rồi tới thứ tự trong section (khung chung của getClassMarkers/getProgressReport).
   */
  private async listTrackedCms(courseId: string): Promise<CmRow[]> {
    const sections = await this.courses.listSections(courseId);
    const sectionOrder = new Map(sections.map((s) => [s.id, s.section]));
    return (await this.courses.listCms(courseId))
      .filter((cm) => cm.completion !== COMPLETION_TRACKING_NONE)
      .sort((a, b) => (sectionOrder.get(a.section) ?? 0) - (sectionOrder.get(b.section) ?? 0));
  }

  /**
   * Id các học sinh đang ghi danh hiệu lực của một khoá, khử trùng (khung chung của getClassMarkers/getProgressReport).
   */
  private async listEnrolledStudentIds(courseId: string): Promise<string[]> {
    const rows = await this.repo.dbHandle
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select(['user_enrolments.user_id as userId'])
      .where((eb) =>
        eb.and([eb('enrol.course_id', '=', courseId), eb('user_enrolments.status', '=', 0)]),
      )
      .execute();
    return [...new Set(rows.map((r) => r.userId))];
  }

  // --- mod_page ---------------------------------------------------------------

  /**
   * Tạo trang đọc: bản ghi page + course module (component mod_page). Quyền tạo hoạt động do CoursesService kiểm (course:manageactivities). Mặc định hoàn thành kiểu manual (mở xem + học sinh tự xác nhận "Đã học") — nội dung đọc không đo được "đã đọc thật" (bảng 2.1 nghiên cứu học liệu số VN); giáo viên đặt 'view' nếu chỉ cần xem là đủ. Nội dung HTML được LÀM SẠCH THEO ALLOWLIST trước khi ghi DB (xem page-content-sanitizer): nội dung trang được phía web render bằng `dangerouslySetInnerHTML`, nên mã thực thi (thẻ script, thuộc tính sự kiện) không được phép tới DB qua đường ghi này.
   */
  async createPage(actorId: string, courseId: string, input: {
    sectionId: string; name: string; content?: string; completionMode?: CompletionMode;
  }): Promise<PageRow & { completionMode: CompletionMode }> {
    await this.courses.getCourse(courseId);
    const mode = input.completionMode ?? 'manual';
    const page = await this.createWithCm({
      actorId, courseId, sectionId: input.sectionId, component: PAGE_COMPONENT, name: input.name, mode,
      insert: () => this.repo.insertPage({ course: courseId, cmId: null, name: input.name, content: sanitizePageContent(input.content ?? '') }),
      attachCmId: (id, cmId) => this.repo.updatePage(id, { cmId }),
      remove: (id) => this.repo.deletePage(id),
    });
    const created = await this.getPage(page.id);
    return { ...created, completionMode: mode };
  }

  /**
   * Lấy trang đọc (kèm chế độ hoàn thành suy từ cm của nó). Nội dung được làm sạch LẠI ở đường đọc: bản ghi đã lưu từ trước khi đường ghi có cổng làm sạch (hoặc được ghi qua đường vòng như
   * import backup bằng repository trực tiếp) có thể còn mang mã thực
   * thi — điểm này là điểm nghẽn đọc mà cả `getPageForUser` lẫn `getPlayer` đều đi qua, nên làm sạch tại đây phủ mọi bề mặt hiển thị nội dung trang. Hàm làm sạch idempotent nên dữ kiện đã qua cổng ghi không bị biến dạng khi làm sạch lần hai.
   */
  async getPage(id: string): Promise<PageRow> {
    const row = await this.repo.getPage(id);
    if (!row) throw new NotFoundException({ message: `Page ${id} not found`, code: 'content.page_not_found' });
    return { ...row, content: sanitizePageContent(row.content) };
  }

  /** Đọc trang đọc cho người xem: phải qua được cổng truy cập khoá học. */
  async getPageForUser(userId: string, id: string): Promise<PageRow & { completionMode: CompletionMode }> {
    const page = await this.getPage(id);
    await this.courses.assertCourseAccess(userId, page.course);
    const cm = page.cmId ? await this.courses.getCm(page.cmId) : null;
    return { ...page, completionMode: cm ? modeOfCm(cm) : 'view' };
  }

  /**
   * Sửa trang đọc (course:manageactivities tại khoá); đổi tên/chế độ
   * hoàn thành đồng bộ sang cm. Nội dung mới cũng qua cùng cổng làm
   * sạch allowlist như đường tạo trước khi ghi DB.
   */
  async updatePage(actorId: string, id: string, input: {
    name?: string; content?: string; completionMode?: CompletionMode;
  }): Promise<PageRow> {
    const page = await this.getPage(id);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(page.course));
    const patch: Partial<PageRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.content !== undefined) patch.content = sanitizePageContent(input.content);
    if (Object.keys(patch).length) await this.repo.updatePage(id, patch);
    await this.syncNameAndModeToCm(actorId, page.cmId, input);
    return this.getPage(id);
  }

  /** Xoá trang đọc: xoá cm qua CoursesService (phát cm_deleted) và xoá bản ghi page. */
  async deletePage(actorId: string, id: string): Promise<void> {
    const page = await this.getPage(id);
    if (page.cmId) await this.courses.deleteCm(actorId, page.cmId);
    await this.repo.deletePage(id);
  }

  // --- mod_resource -------------------------------------------------------------

  /**
   * Chặn URL tài nguyên ngoài mang scheme nguy hiểm: phía web đưa URL
   * này thẳng vào `href` của trang học nên chỉ http/https được phép
   * lưu; scheme kiểu `javascript:`/`data:` bị từ chối bằng mã
   * `content.url_scheme_not_allowed` (tầng hợp đồng cũng có refine
   * tương ứng — hai tầng gác độc lập).
   *
   * @throws BadRequestException khi URL không dùng scheme http/https.
   */
  private assertSafeResourceUrl(url: string): void {
    if (!isSafeExternalResourceUrl(url)) {
      throw new BadRequestException({ message: 'url must use the http or https scheme', code: 'content.url_scheme_not_allowed' });
    }
  }

  /**
   * Tạo tài nguyên: đúng một nguồn (file đã tải lên qua Files, hoặc URL
   * ngoài/video nhúng). Mặc định hoàn thành theo loại nội dung (bảng
   * 2.1): video → progress (xem ≥ ngưỡng), tài liệu → manual, tệp
   * khác và liên kết ngoài → none (chỉ ghi truy cập, ngoài %).
   */
  async createResource(actorId: string, courseId: string, input: {
    sectionId: string; name: string; kind: 'file' | 'url';
    fileId?: string; url?: string; transcript?: string; completionMode?: CompletionMode;
  }): Promise<ResourceRow & { completionMode: CompletionMode }> {
    await this.courses.getCourse(courseId);
    // Nguồn tài nguyên đã narrow vào biến cục bộ: sau bước kiểm tra bắt buộc dưới đây, TypeScript biết chắc fileId/url là string trong đúng nhánh kind của nó.
    let fileId: string | null = null;
    let url: string | null = null;
    let fileMime: string | null = null;
    if (input.kind === 'file') {
      if (!input.fileId) throw new BadRequestException({ message: 'fileId is required for a file resource', code: 'content.file_required' });
      fileId = input.fileId;
      fileMime = (await this.files.getFile(fileId)).mimeType;
    } else {
      if (!input.url) throw new BadRequestException({ message: 'url is required for a link resource', code: 'content.url_required' });
      url = input.url;
      this.assertSafeResourceUrl(url);
    }
    const mode = input.completionMode ?? (input.kind === 'file' ? defaultModeForFile(fileMime) : 'none');
    const resource = await this.createWithCm({
      actorId, courseId, sectionId: input.sectionId, component: RESOURCE_COMPONENT, name: input.name, mode,
      insert: () => this.repo.insertResource({
        course: courseId, cmId: null, name: input.name, kind: input.kind,
        fileId, url, transcript: input.transcript ?? null,
      }),
      attachCmId: (id, cmId) => this.repo.updateResource(id, { cmId }),
      remove: (id) => this.repo.deleteResource(id),
    });
    const created = await this.getResource(resource.id);
    return { ...created, completionMode: mode };
  }

  /** Lấy tài nguyên. */
  async getResource(id: string): Promise<ResourceRow> {
    const row = await this.repo.getResource(id);
    if (!row) throw new NotFoundException({ message: `Resource ${id} not found`, code: 'content.resource_not_found' });
    return row;
  }

  /**
   * Đọc tài nguyên cho người xem: qua cổng khoá học; file kèm URL đã
   * ký để xem/tải. URL ngoài đã lưu từ trước khi có cổng scheme có
   * thể mang scheme nguy hiểm — đường đọc này KHÔNG phát URL đó ra
   * đáp ứng (trả `url: null`, không tính embed) để href nguy hiểm
   * không tới được trang học; bản ghi trong DB giữ nguyên, giáo viên
   * sửa lại URL hợp lệ là hiển thị trở lại bình thường.
   */
  async getResourceForUser(userId: string, id: string): Promise<{
    resource: ResourceRow & { completionMode: CompletionMode };
    file: SignedFileView | null;
    embedUrl: string | null;
  }> {
    const resource = await this.getResource(id);
    await this.courses.assertCourseAccess(userId, resource.course);
    const cm = resource.cmId ? await this.courses.getCm(resource.cmId) : null;
    let file: SignedFileView | null = null;
    if (resource.kind === 'file' && resource.fileId) {
      const row = await this.files.getFile(resource.fileId);
      const signed = await this.files.createSignedUrl(resource.fileId, userId);
      file = { id: row.id, fileName: row.fileName, mimeType: row.mimeType, fileSize: row.fileSize, signedUrl: signed.url, signedUrlExpiresAt: signed.expiresAt };
    }
    const safeUrl = resource.kind === 'url' && resource.url && isSafeExternalResourceUrl(resource.url) ? resource.url : null;
    return {
      resource: {
        ...resource,
        ...(resource.kind === 'url' ? { url: safeUrl } : {}),
        completionMode: cm ? modeOfCm(cm) : 'view',
      },
      file,
      embedUrl: safeUrl ? embedUrlFor(safeUrl) : null,
    };
  }

  /**
   * Sửa tài nguyên (course:manageactivities tại khoá); tên/chế độ
   * hoàn thành đồng bộ sang cm. URL ngoài mới (khi không phải null gỡ
   * nguồn) phải qua cùng cổng scheme như đường tạo.
   */
  async updateResource(actorId: string, id: string, input: {
    name?: string; fileId?: string | null; url?: string | null; transcript?: string | null; completionMode?: CompletionMode;
  }): Promise<ResourceRow> {
    const resource = await this.getResource(id);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(resource.course));
    const patch: Partial<ResourceRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.fileId !== undefined) {
      if (input.fileId) await this.files.getFile(input.fileId);
      patch.fileId = input.fileId; patch.kind = input.fileId ? 'file' : resource.kind;
    }
    if (input.url !== undefined) {
      if (input.url !== null) this.assertSafeResourceUrl(input.url);
      patch.url = input.url;
    }
    if (input.transcript !== undefined) patch.transcript = input.transcript;
    if (Object.keys(patch).length) await this.repo.updateResource(id, patch);
    await this.syncNameAndModeToCm(actorId, resource.cmId, input);
    return this.getResource(id);
  }

  /** Xoá tài nguyên: xoá cm qua CoursesService và xoá bản ghi resource. */
  async deleteResource(actorId: string, id: string): Promise<void> {
    const resource = await this.getResource(id);
    if (resource.cmId) await this.courses.deleteCm(actorId, resource.cmId);
    await this.repo.deleteResource(id);
  }

  /** Dọn instance khi course module bị xoá từ nơi khác (idempotent). */
  @OnEvent('cm_deleted')
  async onCmDeleted(payload: { cmId: string; component?: string }): Promise<void> {
    if (payload.component === PAGE_COMPONENT) await this.repo.deletePageByCm(payload.cmId);
    if (payload.component === RESOURCE_COMPONENT) await this.repo.deleteResourceByCm(payload.cmId);
  }

  // --- tiến độ ------------------------------------------------------------------

  /**
   * Tổng hợp tiến độ của một học sinh trong khoá từ dữ liệu completion:
   * chỉ các cm có bật theo dõi (completion != 0) và hiển thị được với
   * học sinh mới vào mẫu số. % = đã xong / tổng mục theo dõi (làm tròn);
   * percent = null khi khoá chưa có mục nào được theo dõi.
   */
  async getMyProgress(userId: string, courseId: string): Promise<MyProgress> {
    const content = await this.courses.getCourseContent(userId, courseId);
    const completions = await this.completion.listCmCompletionsForCourse(courseId, userId);
    const byCm = new Map(completions.map((c) => [c.cmId, c]));
    const sections: SectionProgress[] = [];
    let total = 0; let completed = 0;
    for (const section of content.sections) {
      const items: OutlineItemProgress[] = [];
      let sTotal = 0; let sCompleted = 0;
      for (const cm of section.modules) {
        const row = byCm.get(cm.id);
        const state = row?.state ?? COMPLETION_INCOMPLETE;
        const done = cm.completion !== COMPLETION_TRACKING_NONE && state !== COMPLETION_INCOMPLETE;
        items.push({
          cmId: cm.id, name: cm.name, component: cm.component, instanceId: cm.instanceId,
          completion: cm.completion, state, viewed: row?.viewed ?? false, done,
        });
        if (cm.completion !== COMPLETION_TRACKING_NONE) { sTotal += 1; if (state !== COMPLETION_INCOMPLETE) sCompleted += 1; }
      }
      total += sTotal; completed += sCompleted;
      sections.push({
        sectionId: section.id, name: section.name, section: section.section,
        total: sTotal, completed: sCompleted,
        percent: sTotal ? Math.round((sCompleted / sTotal) * 100) : null,
        items,
      });
    }
    const last = await this.repo.getLastAccess(userId, courseId);
    const flat = sections.flatMap((s) => s.items);
    const resume = this.resolveResume(flat, last?.cmId ?? null);
    return {
      courseId,
      total, completed,
      percent: total ? Math.round((completed / total) * 100) : null,
      sections,
      lastAccess: last ? { cmId: last.cmId, at: last.accessedAt.toISOString() } : null,
      resume,
    };
  }

  /** Chọn mục "Học tiếp": ưu tiên mục mở gần nhất còn dở, rồi mục theo dõi đầu tiên chưa xong. */
  private resolveResume(flat: OutlineItemProgress[], lastCmId: string | null): MyProgress['resume'] {
    if (!flat.length) return null;
    const byId = new Map(flat.map((i) => [i.cmId, i]));
    const last = lastCmId ? byId.get(lastCmId) : undefined;
    if (last && !last.done) return { cmId: last.cmId, reason: 'last_access' };
    const next = flat.find((i) => i.completion !== COMPLETION_TRACKING_NONE && !i.done);
    if (next) return { cmId: next.cmId, reason: last ? 'next_incomplete' : 'start' };
    if (last) return { cmId: last.cmId, reason: 'all_done' };
    const first = flat[0];
    return first ? { cmId: first.cmId, reason: 'start' } : null;
  }

  /**
   * Mốc "lớp đã học tới đây" cho outline: với mỗi lớp (nhóm của khoá),
   * mốc là cm theo dõi cuối cùng của tiền tố outline mà tại mọi cm trong
   * tiền tố, ít nhất một nửa thành viên lớp đã hoàn thành. Khoá không có
   * nhóm thì tính một mốc cho toàn bộ học sinh đang ghi danh hiệu lực.
   */
  async getClassMarkers(userId: string, courseId: string): Promise<{ courseId: string; trackedTotal: number; markers: ClassMarker[] }> {
    await this.courses.assertCourseAccess(userId, courseId);
    const db = this.repo.dbHandle;
    const cms = await this.listTrackedCms(courseId);
    const trackedIds = cms.map((cm) => cm.id);
    const completedByCm = new Map<string, Set<string>>();
    if (trackedIds.length) {
      const rows = await db
        .selectFrom('course_modules_completion')
        .select([
          'course_module_id as courseModuleId',
          'user_id as userId',
          'completion_state as completionState',
        ])
        .where('course_module_id', 'in', trackedIds)
        .execute();
      for (const row of rows) {
        if (row.completionState === COMPLETION_INCOMPLETE) continue;
        const set = completedByCm.get(row.courseModuleId) ?? new Set<string>();
        set.add(row.userId);
        completedByCm.set(row.courseModuleId, set);
      }
    }
    const markerFor = (scope: 'group' | 'course', groupId: string | null, groupName: string, memberIds: string[]): ClassMarker => {
      const members = new Set(memberIds);
      let markerIndex = -1;
      for (let i = 0; i < cms.length; i += 1) {
        const cm = cms[i];
        if (!cm) break;
        const doneBy = completedByCm.get(cm.id) ?? new Set<string>();
        const done = [...members].filter((m) => doneBy.has(m)).length;
        if (members.size > 0 && done / members.size >= CLASS_MARKER_QUORUM) markerIndex = i; else break;
      }
      let pairs = 0; let donePairs = 0;
      for (const cm of cms) {
        const doneBy = completedByCm.get(cm.id) ?? new Set<string>();
        for (const m of members) { pairs += 1; if (doneBy.has(m)) donePairs += 1; }
      }
      const markerCm = markerIndex >= 0 ? (cms[markerIndex] ?? null) : null;
      return {
        scope, groupId, groupName, memberCount: members.size,
        markerCmId: markerCm?.id ?? null, markerName: markerCm?.name ?? null, markerIndex,
        percent: pairs ? Math.round((donePairs / pairs) * 100) : null,
      };
    };
    const groups = await db
      .selectFrom('course_groups')
      .select(['id', 'name'])
      .where('course_id', '=', courseId)
      .execute();
    const markers: ClassMarker[] = [];
    if (groups.length) {
      const memberRows = await db
        .selectFrom('groups_members')
        .select(['group_id as groupId', 'user_id as userId'])
        .where('group_id', 'in', groups.map((g) => g.id))
        .execute();
      for (const group of groups) {
        const ids = memberRows.filter((r) => r.groupId === group.id).map((r) => r.userId);
        markers.push(markerFor('group', group.id, group.name, ids));
      }
    } else {
      markers.push(markerFor('course', null, 'Toàn khoá', await this.listEnrolledStudentIds(courseId)));
    }
    return { courseId, trackedTotal: cms.length, markers };
  }

  // --- sự kiện học: tiến độ xem (K2-B2/B3) ---------------------------------------

  /**
   * Học sinh báo tiến độ xem một mục (video/trang): sự kiện được LƯU
   * BỀN theo HS–mục–thời điểm; client gửi bù khi rớt mạng nên mạng yếu
   * không làm mất tiến độ. percent chỉ tăng (ôn lại không bị phạt).
   * Mục kiểu progress (video): đạt ngưỡng (mặc định 90%) thì ghi trạng
   * thái hoàn thành vào completion — cùng khuôn ghi state của
   * refreshGradeCompletion — và chụp bản ghi hồ sơ. KHÔNG dùng thời
   * lượng ngồi xem làm điều kiện ở bất kỳ đâu.
   */
  async recordProgress(userId: string, courseId: string, cmId: string, input: {
    percent?: number; positionSeconds?: number; page?: number;
  }): Promise<{ cmId: string; percent: number; positionSeconds: number | null; page: number | null; state: number }> {
    await this.courses.assertCourseAccess(userId, courseId);
    const cm = await this.courses.getCm(cmId);
    if (cm.course !== courseId) throw new NotFoundException({ message: `Course module ${cmId} not found in course ${courseId}`, code: 'content.cm_not_in_course' });
    const access = await this.courses.checkCmAccess(userId, cm);
    if (!access.available) throw new ForbiddenException({ message: 'This activity is not available to you yet', code: 'availability.not_available' });
    const row = await this.repo.upsertModuleProgress(userId, courseId, cmId, input);
    await this.repo.upsertLastAccess(userId, courseId, cmId);
    let state = (await this.completion.getCmCompletion(cmId, userId)).state;
    if (modeOfCm(cm) === 'progress' && row.percent >= VIDEO_COMPLETION_THRESHOLD_PERCENT && state === COMPLETION_INCOMPLETE) {
      const db = this.repo.dbHandle;
      await db
        .insertInto('course_modules_completion')
        .values({
          course_module_id: cmId, user_id: userId, completion_state: COMPLETION_COMPLETE, viewed: true, override_by: null,
        })
        .onConflict((oc) =>
          oc.columns(['course_module_id', 'user_id']).doUpdateSet({
            completion_state: COMPLETION_COMPLETE, viewed: true, updated_at: new Date(),
          }),
        )
        .execute();
      await this.repo.insertLearningRecord({ userId, courseId, cmId, cmName: cm.name, component: cm.component });
      await this.completion.reaggregateCourseCompletion(userId, courseId);
      state = COMPLETION_COMPLETE;
    }
    return { cmId, percent: row.percent, positionSeconds: row.positionSeconds, page: row.page, state };
  }

  // --- báo cáo tiến độ cho giáo viên (K2-B4) --------------------------------------

  /**
   * Báo cáo tiến độ của giáo viên — một payload phục vụ cả ba bề mặt:
   * ma trận lớp × mục (students × items kèm trạng thái từng ô), tổng
   * theo mục (mục nào cả lớp kẹt) và tổng theo học sinh (kèm lần học
   * gần nhất + bản ghi hồ sơ hoàn thành). Lọc theo nhóm (lớp/tổ) bằng
   * groupId. Cổng: quyền quản completion của khoá.
   */
  async getProgressReport(actorId: string, courseId: string, groupId?: string): Promise<{
    courseId: string;
    items: { cmId: string; name: string; component: string; sectionId: string; completedCount: number; totalStudents: number; percent: number | null }[];
    students: ProgressReportStudent[];
  }> {
    await this.completion.requireCompletionManage(actorId, courseId);
    const db = this.repo.dbHandle;
    const cms = await this.listTrackedCms(courseId);
    let studentIds: string[];
    if (groupId) {
      const rows = await db
        .selectFrom('groups_members')
        .select(['user_id as userId'])
        .where('group_id', '=', groupId)
        .execute();
      studentIds = [...new Set(rows.map((r) => r.userId))];
    } else {
      studentIds = await this.listEnrolledStudentIds(courseId);
    }
    const userRows = studentIds.length
      ? await db
        .selectFrom('users')
        .select(['id', 'username', 'first_name as firstName', 'last_name as lastName'])
        .where('id', 'in', studentIds)
        .execute()
      : [];
    const userById = new Map(userRows.map((u) => [u.id, u]));
    const completionRows = cms.length && studentIds.length
      ? await db
        .selectFrom('course_modules_completion')
        .select([
          'course_module_id as courseModuleId',
          'user_id as userId',
          'completion_state as completionState',
        ])
        .where((eb) =>
          eb.and([
            eb('course_module_id', 'in', cms.map((c) => c.id)),
            eb('user_id', 'in', studentIds),
          ]),
        )
        .execute()
      : [];
    const stateOf = new Map(completionRows.map((r) => [`${r.userId}:${r.courseModuleId}`, r.completionState]));
    const records = await this.repo.listLearningRecords(courseId);
    const studentIdSet = new Set(studentIds);
    const recordsByUser = new Map<string, { cmId: string; cmName: string; completedAt: string }[]>();
    for (const record of records) {
      if (!studentIdSet.has(record.userId)) continue;
      const list = recordsByUser.get(record.userId) ?? [];
      list.push({ cmId: record.cmId, cmName: record.cmName, completedAt: record.completedAt.toISOString() });
      recordsByUser.set(record.userId, list);
    }
    const items = cms.map((cm) => {
      const completedCount = studentIds.filter((uid) => (stateOf.get(`${uid}:${cm.id}`) ?? COMPLETION_INCOMPLETE) !== COMPLETION_INCOMPLETE).length;
      return {
        cmId: cm.id, name: cm.name, component: cm.component, sectionId: cm.section,
        completedCount, totalStudents: studentIds.length,
        percent: studentIds.length ? Math.round((completedCount / studentIds.length) * 100) : null,
      };
    });
    // Nạp dấu vết mở học gần nhất của cả lớp song song thay vì chờ từng học sinh một. Repository chưa có phương thức nạp theo lô (một truy vấn cho nhiều user) nên vẫn là một lần đọc mỗi học sinh, chỉ không chờ nối tiếp nhau — muốn gộp thành một truy vấn thì thêm phương thức ở packages/db.
    const lastAccessEntries = await Promise.all(
      studentIds.map(async (userId) => ({ userId, last: await this.repo.getLastAccess(userId, courseId) })),
    );
    const lastAccessByUser = new Map(lastAccessEntries.map((entry) => [entry.userId, entry.last]));
    const students: ProgressReportStudent[] = [];
    for (const userId of studentIds) {
      const user = userById.get(userId);
      const states: Record<string, number> = {};
      let completed = 0;
      for (const cm of cms) {
        const state = stateOf.get(`${userId}:${cm.id}`) ?? COMPLETION_INCOMPLETE;
        states[cm.id] = state;
        if (state !== COMPLETION_INCOMPLETE) completed += 1;
      }
      const last = lastAccessByUser.get(userId);
      students.push({
        userId,
        username: user?.username ?? '',
        fullName: user ? `${user.firstName} ${user.lastName}`.trim() : '',
        completed, total: cms.length,
        percent: cms.length ? Math.round((completed / cms.length) * 100) : null,
        lastAccessAt: last?.accessedAt.toISOString() ?? null,
        states,
        records: recordsByUser.get(userId) ?? [],
      });
    }
    return { courseId, items, students };
  }

  /** Bản CSV của ma trận tiến độ (hàng = học sinh, cột = mục, ô = trạng thái) để giáo viên tải xuống làm minh chứng. */
  async getProgressReportCsv(actorId: string, courseId: string, groupId?: string): Promise<string> {
    const report = await this.getProgressReport(actorId, courseId, groupId);
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ['Học sinh', 'Tên đăng nhập', ...report.items.map((i) => i.name), 'Đã hoàn thành', 'Tổng mục', '% hoàn thành', 'Lần học gần nhất'];
    const lines = [header.map(esc).join(',')];
    for (const student of report.students) {
      const cells = report.items.map((item) => ((student.states[item.cmId] ?? COMPLETION_INCOMPLETE) !== COMPLETION_INCOMPLETE ? 'x' : ''));
      lines.push([
        student.fullName, student.username, ...cells,
        String(student.completed), String(student.total),
        student.percent === null ? '' : String(student.percent),
        student.lastAccessAt ?? '',
      ].map(esc).join(','));
    }
    return lines.join('\n');
  }

  // --- mẫu cấu trúc bài học theo khung 5512 (K2-B5) -------------------------------

  /**
   * Tạo bộ section mẫu "bài học" theo khung kế hoạch bài dạy (CV 5512): Mở đầu → Hình thành kiến thức mới → Luyện tập → Vận dụng → Kiểm tra nhanh & tổng kết. Đây là KHUNG GỢI Ý ở mức cấu trúc section — giáo viên thêm nội dung thật vào từng phần và sửa/xoá tự do, hệ thống không ép cứng luồng soạn. Phần kiến thức mới mang sẵn dòng nhắc ghi mục tiêu neo YCCĐ trong tóm tắt section.
   */
  async createLessonTemplate(actorId: string, courseId: string, input: { title?: string }): Promise<{ id: string; name: string | null; section: number }[]> {
    await this.courses.getCourse(courseId);
    const prefix = input.title ? `${input.title} — ` : '';
    const parts: { name: string; summary: string }[] = [
      { name: 'Mở đầu', summary: '' },
      { name: 'Hình thành kiến thức mới', summary: 'Mục tiêu bài học (neo YCCĐ của chương trình GDPT 2018): giáo viên ghi mục tiêu/YCCĐ của bài tại đây.' },
      { name: 'Luyện tập', summary: '' },
      { name: 'Vận dụng', summary: '' },
      { name: 'Kiểm tra nhanh & tổng kết', summary: '' },
    ];
    const created: { id: string; name: string | null; section: number }[] = [];
    for (const part of parts) {
      const section = await this.courses.createSection(actorId, courseId, { name: `${prefix}${part.name}`, summary: part.summary });
      created.push({ id: section.id, name: section.name, section: section.section });
    }
    return created;
  }

  // --- player -------------------------------------------------------------------

  /**
   * Dữ liệu trang học (player) cho một cm: nội dung của mục, outline kèm
   * trạng thái hoàn thành của chính học sinh, mục Trước/Tiếp và tiến độ
   * tổng. Mở player là hành vi "truy cập học" — ghi last-access để Học
   * tiếp đưa học sinh về đúng mục dở dang.
   */
  async getPlayer(userId: string, courseId: string, cmId: string): Promise<{
    course: { id: string; fullName: string; shortName: string };
    cm: CmRow;
    content:
      | { type: 'page'; page: PageRow }
      | { type: 'resource'; resource: ResourceRow; file: SignedFileView | null; embedUrl: string | null }
      | { type: 'other'; component: string };
    completion: { state: number; viewed: boolean; mode: CompletionMode };
    /** Tiến độ xem của chính học sinh ở mục này (video/trang): % cao nhất + vị trí dở để phát tiếp đúng chỗ. */
    itemProgress: { percent: number; positionSeconds: number | null; page: number | null } | null;
    progress: MyProgress;
    prevCmId: string | null; nextCmId: string | null;
  }> {
    const courseRow = await this.courses.assertCourseAccess(userId, courseId);
    const cm = await this.courses.getCm(cmId);
    if (cm.course !== courseId) throw new NotFoundException({ message: `Course module ${cmId} not found in course ${courseId}`, code: 'content.cm_not_in_course' });
    const access = await this.courses.checkCmAccess(userId, cm);
    if (!access.available) throw new ForbiddenException({ message: 'This activity is not available to you yet', code: 'availability.not_available' });
    await this.repo.upsertLastAccess(userId, courseId, cmId);
    let content: { type: 'page'; page: PageRow } | { type: 'resource'; resource: ResourceRow; file: SignedFileView | null; embedUrl: string | null } | { type: 'other'; component: string };
    if (cm.component === PAGE_COMPONENT && cm.instanceId) {
      content = { type: 'page', page: await this.getPage(cm.instanceId) };
    } else if (cm.component === RESOURCE_COMPONENT && cm.instanceId) {
      const view = await this.getResourceForUser(userId, cm.instanceId);
      content = { type: 'resource', resource: view.resource, file: view.file, embedUrl: view.embedUrl };
    } else {
      content = { type: 'other', component: cm.component };
    }
    const progress = await this.getMyProgress(userId, courseId);
    const flat = progress.sections.flatMap((s) => s.items);
    const idx = flat.findIndex((i) => i.cmId === cmId);
    const mine = await this.completion.getCmCompletion(cmId, userId);
    const item = await this.repo.getModuleProgress(userId, cmId);
    return {
      course: { id: courseRow.id, fullName: courseRow.fullName, shortName: courseRow.shortName },
      cm,
      content,
      completion: { state: mine.state, viewed: mine.viewed, mode: modeOfCm(cm) },
      itemProgress: item ? { percent: item.percent, positionSeconds: item.positionSeconds, page: item.page } : null,
      progress,
      prevCmId: idx > 0 ? (flat[idx - 1]?.cmId ?? null) : null,
      nextCmId: idx >= 0 && idx < flat.length - 1 ? (flat[idx + 1]?.cmId ?? null) : null,
    };
  }
}
