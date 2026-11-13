import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { SocialRepository, type CommentRow } from '@giaokhoa/db/repositories/social';

@Injectable()
export class CommentsService {
  constructor(
    private readonly repo: SocialRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly courses: CoursesService,
  ) {}

  private async assertItemAccess(actorId: string, contextId: string): Promise<void> {
    const ctx = await this.contexts.getContext(contextId).catch(() => undefined);
    if (!ctx) return;
    if (ctx.contextLevel === 50) await this.courses.assertCourseAccess(actorId, ctx.instanceId!);
    if (ctx.contextLevel === 70) {
      const cm = await this.courses.getCm(ctx.instanceId!);
      await this.courses.assertCourseAccess(actorId, cm.course);
    }
  }

  async addComment(actorId: string, input: {
    contextId: string; component: string; commentArea: string; itemId: string; content: string;
  }): Promise<CommentRow> {
    await this.evaluator.requireCapability(actorId, 'comment:post', input.contextId);
    await this.assertItemAccess(actorId, input.contextId);
    return this.repo.insertComment({
      contextId: input.contextId, component: input.component, commentArea: input.commentArea,
      itemId: input.itemId, content: input.content, userId: actorId,
    });
  }

  async listComments(viewerId: string, input: {
    contextId: string; component: string; commentArea: string; itemId: string;
  }): Promise<{ comments: CommentRow[]; count: number; canpost: boolean }> {
    await this.evaluator.requireCapability(viewerId, 'comment:view', input.contextId);
    await this.assertItemAccess(viewerId, input.contextId);
    const rows = await this.repo.listComments(input.component, input.commentArea, input.itemId, input.contextId);
    const canpost = await this.evaluator.hasCapability(viewerId, 'comment:post', input.contextId);
    return { comments: rows, count: rows.length, canpost };
  }

  async deleteComment(actorId: string, commentId: string): Promise<{ deleted: boolean }> {
    const comment = await this.repo.getComment(commentId);
    if (!comment || comment.timeDeleted) throw new NotFoundException({ message: `Comment ${commentId} not found`, code: 'comments.not_found' });
    if (comment.userId !== actorId) {
      const canDelete = await this.evaluator.hasCapability(actorId, 'comment:delete', comment.contextId);
      if (!canDelete) {
        throw new ForbiddenException({ message: 'Only the author or a user with comment:delete can delete this comment', code: 'comments.delete_forbidden' });
      }
    }
    await this.repo.softDeleteComment(commentId);
    return { deleted: true };
  }
}
