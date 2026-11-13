import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { GradesService } from '../grades/grades.service';
import { SocialRepository, type RatingRow } from '@giaokhoa/db/repositories/social';

export interface RatingAggregate {
  component: string;
  ratingArea: string;
  itemId: string;
  count: number;
  average: number | null;
  sum: number;
  min: number | null;
  max: number | null;
}

@Injectable()
export class RatingsService {
  constructor(
    private readonly repo: SocialRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly grades: GradesService,
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

  private async scaleMax(scaleId: number): Promise<number> {
    return Math.abs(scaleId);
  }

  async rate(actorId: string, input: {
    contextId: string; component: string; ratingArea: string; itemId: string; scaleId: number; rating: number;
  }): Promise<RatingRow> {
    await this.evaluator.requireCapability(actorId, 'rating:rate', input.contextId);
    await this.assertItemAccess(actorId, input.contextId);
    const max = await this.scaleMax(input.scaleId);
    if (!Number.isInteger(input.rating) || input.rating < 0 || (max > 0 && input.rating > max)) {
      throw new BadRequestException({
        message: `Rating ${input.rating} is outside the scale (0..${max})`,
        code: 'ratings.outside_scale',
      });
    }
    return this.repo.upsertRating({
      contextId: input.contextId, component: input.component, ratingArea: input.ratingArea,
      itemId: input.itemId, scaleId: input.scaleId, rating: input.rating, userId: actorId,
    });
  }

  async aggregate(viewerId: string, input: {
    contextId: string; component: string; ratingArea: string; itemId: string;
  }): Promise<RatingAggregate> {
    await this.evaluator.requireCapability(viewerId, 'rating:view', input.contextId);
    await this.assertItemAccess(viewerId, input.contextId);
    const rows = await this.repo.listRatings(input.component, input.ratingArea, input.itemId, input.contextId);
    const values = rows.map((r) => r.rating);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      component: input.component, ratingArea: input.ratingArea, itemId: input.itemId,
      count: rows.length,
      average: rows.length ? sum / rows.length : null,
      sum,
      min: rows.length ? Math.min(...values) : null,
      max: rows.length ? Math.max(...values) : null,
    };
  }

  async listRatings(viewerId: string, input: {
    contextId: string; component: string; ratingArea: string; itemId: string;
  }): Promise<RatingRow[]> {
    await this.evaluator.requireCapability(viewerId, 'rating:viewall', input.contextId);
    await this.assertItemAccess(viewerId, input.contextId);
    return this.repo.listRatings(input.component, input.ratingArea, input.itemId, input.contextId);
  }
}
