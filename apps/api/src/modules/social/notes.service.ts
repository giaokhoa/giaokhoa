import { Injectable } from '@nestjs/common';
import { badRequest, forbidden, notFound } from '../../common/http-errors';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { SocialRepository, type NoteRow } from '@giaokhoa/db/repositories/social';

@Injectable()
export class NotesService {
  constructor(
    private readonly repo: SocialRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly courses: CoursesService,
  ) {}

  async createNote(actorId: string, input: {
    userId: string; courseId?: string; content: string; publishState?: string; groupId?: string;
  }): Promise<NoteRow> {
    const publishState = input.publishState ?? 'draft';
    if (!['draft', 'public', 'site'].includes(publishState)) {
      badRequest(`Unknown publishState ${publishState}`, 'notes.bad_publishstate');
    }
    if (publishState === 'public' && !input.courseId) {
      badRequest('A course (public) note requires courseId', 'notes.course_required');
    }
    const ctxId = (publishState === 'public' || (publishState === 'draft' && input.courseId))
      ? await this.courses.courseContextId(input.courseId!)
      : (await this.contexts.ensureSystemContext()).id;
    await this.evaluator.requireCapability(actorId, 'notes:create', ctxId);
    return this.repo.insertNote({
      courseId: input.courseId ?? null, userId: input.userId, createdBy: actorId,
      content: input.content, publishState, groupId: input.groupId ?? null, userModified: actorId,
    });
  }

  async canView(note: NoteRow, viewerId: string): Promise<boolean> {
    if (note.createdBy === viewerId) return true;
    if (await this.evaluator.isSiteAdmin(viewerId)) return true;
    if (note.publishState === 'draft') return false;
    if (note.publishState === 'public') {
      const ctx = await this.courses.courseContextId(note.courseId!);
      return this.evaluator.hasCapability(viewerId, 'notes:view', ctx);
    }
    const systemCtx = await this.contexts.ensureSystemContext();
    return this.evaluator.hasCapabilityFromRealAssignment(viewerId, 'notes:view', systemCtx.id);
  }

  async listNotesAbout(viewerId: string, subjectUserId: string, courseId?: string): Promise<NoteRow[]> {
    const rows = await this.repo.listNotesAbout(subjectUserId);
    const out: NoteRow[] = [];
    for (const note of rows) {
      if (courseId !== undefined && note.publishState === 'public' && note.courseId !== courseId) continue;
      if (await this.canView(note, viewerId)) out.push(note);
    }
    return out;
  }

  async getNote(viewerId: string, id: string): Promise<NoteRow> {
    const note = await this.repo.getNote(id);
    if (!note) notFound(`Note ${id} not found`, 'notes.not_found');
    if (!(await this.canView(note, viewerId))) {
      forbidden('You cannot view this note', 'notes.view_forbidden');
    }
    return note;
  }

  async deleteNote(actorId: string, id: string): Promise<{ deleted: boolean }> {
    const note = await this.repo.getNote(id);
    if (!note) notFound(`Note ${id} not found`, 'notes.not_found');
    if (note.createdBy !== actorId) {
      const ctx = note.publishState === 'public'
        ? await this.courses.courseContextId(note.courseId!)
        : (await this.contexts.ensureSystemContext()).id;
      await this.evaluator.requireCapability(actorId, 'notes:manage', ctx);
    }
    await this.repo.deleteNote(id);
    return { deleted: true };
  }
}
