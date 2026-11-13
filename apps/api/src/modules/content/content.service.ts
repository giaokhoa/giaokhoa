import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ContentRepository, type PageRow, type ResourceRow } from '@giaokhoa/db/repositories/content';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CompletionService } from '../completion/completion.service';
import { CoursesService } from '../courses/courses.service';
import type { CmRow } from '@giaokhoa/db/repositories/courses';
import { SystemMaterialsService } from '../system-bank/system-materials.service';
import { FilesService } from '../files/files.service';
import { isSafeExternalResourceUrl, sanitizePageContent } from './page-content-sanitizer';

export const PAGE_COMPONENT = 'mod_page';
export const RESOURCE_COMPONENT = 'mod_resource';

export const VIDEO_COMPLETION_THRESHOLD_PERCENT = 90;

type CompletionMode = 'view' | 'manual' | 'progress' | 'none';

function completionFields(mode: CompletionMode): { completion: number; completionView: boolean; completionManual: boolean; completionUseGrade: boolean } {
  if (mode === 'view') return { completion: 2, completionView: true, completionManual: false, completionUseGrade: false };
  if (mode === 'manual') return { completion: 1, completionView: false, completionManual: true, completionUseGrade: false };
  if (mode === 'progress') return { completion: 2, completionView: false, completionManual: false, completionUseGrade: false };
  return { completion: 0, completionView: false, completionManual: false, completionUseGrade: false };
}

function modeOfCm(cm: CmRow): CompletionMode {
  if (cm.completion === 0) return 'none';
  if (cm.completionView) return 'view';
  if (cm.completionManual || cm.completion === 1) return 'manual';
  return 'progress';
}

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

@Injectable()
export class ContentService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly courses: CoursesService,
    private readonly completion: CompletionService,
    private readonly files: FilesService,
    private readonly evaluator: PermissionEvaluator,
    private readonly systemMaterials: SystemMaterialsService,
  ) {
    this.completion.registerCmCompletionHook(async ({ cmId, courseId, userId }) => {
      const cm = await this.courses.getCm(cmId).catch(() => undefined);
      await this.repo.insertLearningRecord({
        userId, courseId, cmId,
        cmName: cm?.name ?? '', component: cm?.component ?? '',
      });
    });
  }


  async createPage(actorId: string, courseId: string, input: {
    sectionId: string; name: string; content?: string; completionMode?: CompletionMode;
  }): Promise<PageRow & { completionMode: CompletionMode }> {
    await this.courses.getCourse(courseId);
    const mode = input.completionMode ?? 'manual';
    const page = await this.repo.insertPage({ course: courseId, cmId: null, name: input.name, content: sanitizePageContent(input.content ?? '') });
    try {
      const cm = await this.courses.createCm(actorId, courseId, {
        sectionId: input.sectionId, component: PAGE_COMPONENT, instanceId: page.id, name: input.name,
        ...completionFields(mode),
      });
      await this.repo.updatePage(page.id, { cmId: cm.id });
    } catch (err) {
      await this.repo.deletePage(page.id).catch(() => undefined);
      throw err;
    }
    const created = await this.getPage(page.id);
    return { ...created, completionMode: mode };
  }

  async getPage(id: string): Promise<PageRow> {
    const row = await this.repo.getPage(id);
    if (!row) throw new NotFoundException({ message: `Page ${id} not found`, code: 'content.page_not_found' });
    return { ...row, content: sanitizePageContent(row.content) };
  }

  async getPageForUser(userId: string, id: string): Promise<PageRow & { completionMode: CompletionMode }> {
    const page = await this.getPage(id);
    await this.courses.assertCourseAccess(userId, page.course);
    const cm = page.cmId ? await this.courses.getCm(page.cmId) : null;
    return { ...page, completionMode: cm ? modeOfCm(cm) : 'view' };
  }

  async updatePage(actorId: string, id: string, input: {
    name?: string; content?: string; completionMode?: CompletionMode;
  }): Promise<PageRow> {
    const page = await this.getPage(id);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(page.course));
    const patch: Partial<PageRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.content !== undefined) patch.content = sanitizePageContent(input.content);
    if (Object.keys(patch).length) await this.repo.updatePage(id, patch);
    if (page.cmId && (input.name !== undefined || input.completionMode !== undefined)) {
      await this.courses.updateCm(actorId, page.cmId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.completionMode !== undefined ? completionFields(input.completionMode) : {}),
      });
    }
    return this.getPage(id);
  }

  async deletePage(actorId: string, id: string): Promise<void> {
    const page = await this.getPage(id);
    if (page.cmId) await this.courses.deleteCm(actorId, page.cmId);
    await this.repo.deletePage(id);
  }


  private assertSafeResourceUrl(url: string): void {
    if (!isSafeExternalResourceUrl(url)) {
      throw new BadRequestException({ message: 'url must use the http or https scheme', code: 'content.url_scheme_not_allowed' });
    }
  }

  async createResource(actorId: string, courseId: string, input: {
    sectionId: string; name: string; kind: 'file' | 'url';
    fileId?: string; url?: string; transcript?: string; completionMode?: CompletionMode;
  }): Promise<ResourceRow & { completionMode: CompletionMode }> {
    await this.courses.getCourse(courseId);
    let fileMime: string | null = null;
    if (input.kind === 'file') {
      if (!input.fileId) throw new BadRequestException({ message: 'fileId is required for a file resource', code: 'content.file_required' });
      fileMime = (await this.files.getFile(input.fileId)).mimeType;
    } else {
      if (!input.url) throw new BadRequestException({ message: 'url is required for a link resource', code: 'content.url_required' });
      this.assertSafeResourceUrl(input.url);
    }
    const mode = input.completionMode ?? (input.kind === 'file' ? defaultModeForFile(fileMime) : 'none');
    const resource = await this.repo.insertResource({
      course: courseId, cmId: null, name: input.name, kind: input.kind,
      fileId: input.kind === 'file' ? input.fileId! : null,
      url: input.kind === 'url' ? input.url! : null,
      transcript: input.transcript ?? null,
    });
    try {
      const cm = await this.courses.createCm(actorId, courseId, {
        sectionId: input.sectionId, component: RESOURCE_COMPONENT, instanceId: resource.id, name: input.name,
        ...completionFields(mode),
      });
      await this.repo.updateResource(resource.id, { cmId: cm.id });
    } catch (err) {
      await this.repo.deleteResource(resource.id).catch(() => undefined);
      throw err;
    }
    const created = await this.getResource(resource.id);
    return { ...created, completionMode: mode };
  }

  async getResource(id: string): Promise<ResourceRow> {
    const row = await this.repo.getResource(id);
    if (!row) throw new NotFoundException({ message: `Resource ${id} not found`, code: 'content.resource_not_found' });
    return row;
  }

  async getResourceForUser(userId: string, id: string): Promise<{
    resource: ResourceRow & { completionMode: CompletionMode; publication?: import('@giaokhoa/contracts').SystemMaterialVersion };
    file: { id: string; fileName: string; mimeType: string | null; fileSize: number; signedUrl: string; signedUrlExpiresAt: number; contentUrl?: string } | null;
    embedUrl: string | null;
  }> {
    const resource = await this.getResource(id);
    await this.courses.assertCourseAccess(userId, resource.course);
    const cm = resource.cmId ? await this.courses.getCm(resource.cmId) : null;
    if (cm && !(await this.courses.checkCmAccess(userId, cm)).available) {
      throw new ForbiddenException({ message: 'Activity unavailable', code: 'availability.not_available' });
    }
    const reference = await this.systemMaterials.reference(id);
    if (reference) {
      const published = await this.systemMaterials.forCourse(userId, resource, reference);
      const pkg = published.package;
      const contentUrl = `/api/v1/resources/${id}/system-material/content`;
      return {
        resource: { ...resource, name: pkg.name, kind: pkg.file ? 'file' : 'url', url: pkg.externalUrl,
          completionMode: cm ? modeOfCm(cm) : 'none', publication: published },
        file: pkg.file ? { id, fileName: pkg.file.fileName, mimeType: pkg.file.mimeType, fileSize: pkg.file.fileSize,
          signedUrl: contentUrl, signedUrlExpiresAt: 0, contentUrl } : null,
        embedUrl: pkg.externalUrl ? embedUrlFor(pkg.externalUrl) : null,
      };
    }
    let file: { id: string; fileName: string; mimeType: string | null; fileSize: number; signedUrl: string; signedUrlExpiresAt: number; contentUrl?: string } | null = null;
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

  async readSystemMaterialFile(userId: string, id: string) {
    const resource = await this.getResource(id);
    const version = await this.systemMaterials.forCourse(userId, resource);
    return this.systemMaterials.readFile(version.package);
  }

  async updateResource(actorId: string, id: string, input: {
    name?: string; fileId?: string | null; url?: string | null; transcript?: string | null; completionMode?: CompletionMode;
  }): Promise<ResourceRow> {
    const resource = await this.getResource(id);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(resource.course));
    if (await this.systemMaterials.reference(id)) {
      throw new ConflictException({ message: 'Published material is immutable', code: 'system_material.reference_immutable' });
    }
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
    if (resource.cmId && (input.name !== undefined || input.completionMode !== undefined)) {
      await this.courses.updateCm(actorId, resource.cmId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.completionMode !== undefined ? completionFields(input.completionMode) : {}),
      });
    }
    return this.getResource(id);
  }

  async deleteResource(actorId: string, id: string): Promise<void> {
    const resource = await this.getResource(id);
    if (resource.cmId) await this.courses.deleteCm(actorId, resource.cmId);
    await this.repo.deleteResource(id);
  }

  @OnEvent('cm_deleted')
  async onCmDeleted(payload: { cmId: string; component?: string }): Promise<void> {
    if (payload.component === PAGE_COMPONENT) await this.repo.deletePageByCm(payload.cmId);
    if (payload.component === RESOURCE_COMPONENT) await this.repo.deleteResourceByCm(payload.cmId);
  }


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
        const state = row?.state ?? 0;
        const done = cm.completion !== 0 && state !== 0;
        items.push({
          cmId: cm.id, name: cm.name, component: cm.component, instanceId: cm.instanceId,
          completion: cm.completion, state, viewed: row?.viewed ?? false, done,
        });
        if (cm.completion !== 0) { sTotal += 1; if (state !== 0) sCompleted += 1; }
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

  private resolveResume(flat: OutlineItemProgress[], lastCmId: string | null): MyProgress['resume'] {
    if (!flat.length) return null;
    const byId = new Map(flat.map((i) => [i.cmId, i]));
    const last = lastCmId ? byId.get(lastCmId) : undefined;
    if (last && !last.done) return { cmId: last.cmId, reason: 'last_access' };
    const next = flat.find((i) => i.completion !== 0 && !i.done);
    if (next) return { cmId: next.cmId, reason: last ? 'next_incomplete' : 'start' };
    if (last) return { cmId: last.cmId, reason: 'all_done' };
    return { cmId: flat[0]!.cmId, reason: 'start' };
  }

  async getClassMarkers(userId: string, courseId: string): Promise<{ courseId: string; trackedTotal: number; markers: ClassMarker[] }> {
    await this.courses.assertCourseAccess(userId, courseId);
    const db = this.repo.dbHandle;
    const sections = await this.courses.listSections(courseId);
    const sectionOrder = new Map(sections.map((s) => [s.id, s.section]));
    const cms = (await this.courses.listCms(courseId))
      .filter((cm) => cm.completion !== 0)
      .sort((a, b) => (sectionOrder.get(a.section) ?? 0) - (sectionOrder.get(b.section) ?? 0));
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
        if (row.completionState === 0) continue;
        const set = completedByCm.get(row.courseModuleId) ?? new Set<string>();
        set.add(row.userId);
        completedByCm.set(row.courseModuleId, set);
      }
    }
    const markerFor = (scope: 'group' | 'course', groupId: string | null, groupName: string, memberIds: string[]): ClassMarker => {
      const members = new Set(memberIds);
      let markerIndex = -1;
      for (let i = 0; i < cms.length; i += 1) {
        const doneBy = completedByCm.get(cms[i]!.id) ?? new Set<string>();
        const done = [...members].filter((m) => doneBy.has(m)).length;
        if (members.size > 0 && done / members.size >= 0.5) markerIndex = i; else break;
      }
      let pairs = 0; let donePairs = 0;
      for (const cm of cms) {
        const doneBy = completedByCm.get(cm.id) ?? new Set<string>();
        for (const m of members) { pairs += 1; if (doneBy.has(m)) donePairs += 1; }
      }
      const markerCm = markerIndex >= 0 ? cms[markerIndex]! : null;
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
      const rows = await db
        .selectFrom('user_enrolments')
        .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
        .select(['user_enrolments.user_id as userId'])
        .where((eb) =>
          eb.and([eb('enrol.course_id', '=', courseId), eb('user_enrolments.status', '=', 0)]),
        )
        .execute();
      markers.push(markerFor('course', null, 'Toàn khoá', [...new Set(rows.map((r) => r.userId))]));
    }
    return { courseId, trackedTotal: cms.length, markers };
  }


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
    if (modeOfCm(cm) === 'progress' && row.percent >= VIDEO_COMPLETION_THRESHOLD_PERCENT && state === 0) {
      const db = this.repo.dbHandle;
      await db
        .insertInto('course_modules_completion')
        .values({
          course_module_id: cmId, user_id: userId, completion_state: 1, viewed: true, override_by: null,
        })
        .onConflict((oc) =>
          oc.columns(['course_module_id', 'user_id']).doUpdateSet({
            completion_state: 1, viewed: true, updated_at: new Date(),
          }),
        )
        .execute();
      await this.repo.insertLearningRecord({ userId, courseId, cmId, cmName: cm.name, component: cm.component });
      await this.completion.reaggregateCourseCompletion(userId, courseId);
      state = 1;
    }
    return { cmId, percent: row.percent, positionSeconds: row.positionSeconds, page: row.page, state };
  }


  async getProgressReport(actorId: string, courseId: string, groupId?: string): Promise<{
    courseId: string;
    items: { cmId: string; name: string; component: string; sectionId: string; completedCount: number; totalStudents: number; percent: number | null }[];
    students: {
      userId: string; username: string; fullName: string;
      completed: number; total: number; percent: number | null;
      lastAccessAt: string | null;
      states: Record<string, number>;
      records: { cmId: string; cmName: string; completedAt: string }[];
    }[];
  }> {
    await this.completion.requireCompletionManage(actorId, courseId);
    const db = this.repo.dbHandle;
    const sections = await this.courses.listSections(courseId);
    const sectionOrder = new Map(sections.map((s) => [s.id, s.section]));
    const cms = (await this.courses.listCms(courseId))
      .filter((cm) => cm.completion !== 0)
      .sort((a, b) => (sectionOrder.get(a.section) ?? 0) - (sectionOrder.get(b.section) ?? 0));
    let studentIds: string[];
    if (groupId) {
      const rows = await db
        .selectFrom('groups_members')
        .select(['user_id as userId'])
        .where('group_id', '=', groupId)
        .execute();
      studentIds = [...new Set(rows.map((r) => r.userId))];
    } else {
      const rows = await db
        .selectFrom('user_enrolments')
        .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
        .select(['user_enrolments.user_id as userId'])
        .where((eb) =>
          eb.and([eb('enrol.course_id', '=', courseId), eb('user_enrolments.status', '=', 0)]),
        )
        .execute();
      studentIds = [...new Set(rows.map((r) => r.userId))];
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
    const recordsByUser = new Map<string, { cmId: string; cmName: string; completedAt: string }[]>();
    for (const record of records) {
      if (!studentIds.includes(record.userId)) continue;
      const list = recordsByUser.get(record.userId) ?? [];
      list.push({ cmId: record.cmId, cmName: record.cmName, completedAt: record.completedAt.toISOString() });
      recordsByUser.set(record.userId, list);
    }
    const items = cms.map((cm) => {
      const completedCount = studentIds.filter((uid) => (stateOf.get(`${uid}:${cm.id}`) ?? 0) !== 0).length;
      return {
        cmId: cm.id, name: cm.name, component: cm.component, sectionId: cm.section,
        completedCount, totalStudents: studentIds.length,
        percent: studentIds.length ? Math.round((completedCount / studentIds.length) * 100) : null,
      };
    });
    const students = [];
    for (const userId of studentIds) {
      const user = userById.get(userId);
      const states: Record<string, number> = {};
      let completed = 0;
      for (const cm of cms) {
        const state = stateOf.get(`${userId}:${cm.id}`) ?? 0;
        states[cm.id] = state;
        if (state !== 0) completed += 1;
      }
      const last = await this.repo.getLastAccess(userId, courseId);
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

  async getProgressReportCsv(actorId: string, courseId: string, groupId?: string): Promise<string> {
    const report = await this.getProgressReport(actorId, courseId, groupId);
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ['Học sinh', 'Tên đăng nhập', ...report.items.map((i) => i.name), 'Đã hoàn thành', 'Tổng mục', '% hoàn thành', 'Lần học gần nhất'];
    const lines = [header.map(esc).join(',')];
    for (const student of report.students) {
      const cells = report.items.map((item) => ((student.states[item.cmId] ?? 0) !== 0 ? 'x' : ''));
      lines.push([
        student.fullName, student.username, ...cells,
        String(student.completed), String(student.total),
        student.percent === null ? '' : String(student.percent),
        student.lastAccessAt ?? '',
      ].map(esc).join(','));
    }
    return lines.join('\n');
  }


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


  async getPlayer(userId: string, courseId: string, cmId: string): Promise<{
    course: { id: string; fullName: string; shortName: string };
    cm: CmRow;
    content:
      | { type: 'page'; page: PageRow }
      | { type: 'resource'; resource: ResourceRow; file: { id: string; fileName: string; mimeType: string | null; fileSize: number; signedUrl: string; signedUrlExpiresAt: number; contentUrl?: string } | null; embedUrl: string | null }
      | { type: 'other'; component: string };
    completion: { state: number; viewed: boolean; mode: CompletionMode };
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
    let content: { type: 'page'; page: PageRow } | { type: 'resource'; resource: ResourceRow; file: { id: string; fileName: string; mimeType: string | null; fileSize: number; signedUrl: string; signedUrlExpiresAt: number; contentUrl?: string } | null; embedUrl: string | null } | { type: 'other'; component: string };
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
      prevCmId: idx > 0 ? flat[idx - 1]!.cmId : null,
      nextCmId: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1]!.cmId : null,
    };
  }
}
