import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsRepository, type InsightRow, type ModelRow } from '@giaokhoa/db/repositories/analytics';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { EnrolService } from '../enrol/enrol.service';

export interface AnalyticsIndicator {
  name: string;
  calculate(userId: string, courseId: string): Promise<number>;
}
export interface AnalyticsModelProvider {
  name: string;
  target: string;
  indicators: string[];
}

@Injectable()
export class AnalyticsService {
  private readonly indicators = new Map<string, AnalyticsIndicator>();
  private readonly modelProviders: AnalyticsModelProvider[] = [
    { name: 'students_at_risk', target: 'at_risk', indicators: ['no_recent_access', 'low_grade'] },
  ];

  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly courses: CoursesService,
    private readonly enrol: EnrolService,
  ) {
    this.registerBuiltinIndicators();
  }

  registerIndicator(ind: AnalyticsIndicator): void { this.indicators.set(ind.name, ind); }
  listIndicators(): string[] { return [...this.indicators.keys()]; }
  listModelProviders(): AnalyticsModelProvider[] { return this.modelProviders; }

  private registerBuiltinIndicators(): void {
    const db = this.repo.dbHandle;
    this.registerIndicator({
      name: 'no_recent_access',
      calculate: async (userId) => {
        const u = await db
          .selectFrom('users')
          .select(['id', 'last_login as lastLogin'])
          .where('id', '=', userId)
          .executeTakeFirst();
        if (!u || !u.lastLogin) return 1;
        return Date.now() - u.lastLogin.getTime() > 14 * 24 * 3600 * 1000 ? 1 : 0;
      },
    });
    this.registerIndicator({
      name: 'low_grade',
      calculate: async (userId, courseId) => {
        const items = await db
          .selectFrom('grade_items')
          .select(['id', 'grade_max as gradeMax'])
          .where('course_id', '=', courseId)
          .execute();
        if (!items.length) return 0;
        const grades = await db
          .selectFrom('grade_grades')
          .select(['user_id as userId', 'item_id as itemId', 'final_grade as finalGrade'])
          .execute();
        const mine = grades.filter((g) => g.userId === userId && items.some((i) => i.id === g.itemId) && g.finalGrade !== null);
        if (!mine.length) return 0.5;
        const pct = mine.reduce((sum, g) => {
          const item = items.find((i) => i.id === g.itemId)!;
          return sum + (item.gradeMax > 0 ? (g.finalGrade ?? 0) / item.gradeMax : 0);
        }, 0) / mine.length;
        return pct < 0.5 ? 1 - pct : 0;
      },
    });
  }

  async syncModels(): Promise<ModelRow[]> {
    const out: ModelRow[] = [];
    for (const p of this.modelProviders) out.push(await this.repo.upsertModel({ name: p.name, target: p.target, indicators: p.indicators, enabled: true }));
    return out;
  }
  async listModels(): Promise<ModelRow[]> { await this.syncModels(); return this.repo.listModels(); }
  async getModelByName(name: string): Promise<ModelRow> {
    await this.syncModels();
    const row = await this.repo.getModelByName(name);
    if (!row) throw new NotFoundException({ message: `Model ${name} not found`, code: 'analytics.model_not_found' });
    return row;
  }

  async runModel(actorId: string, modelName: string, courseId: string): Promise<{ predictions: number; insights: number }> {
    const ctxId = await this.courses.courseContextId(courseId);
    await this.evaluator.requireCapability(actorId, 'analytics:manage', ctxId);
    const model = await this.getModelByName(modelName);
    const providerDef = this.modelProviders.find((p) => p.name === modelName);
    if (!providerDef) throw new NotFoundException({ message: `Model provider ${modelName} not registered`, code: 'analytics.provider_not_found' });
    const db = this.repo.dbHandle;
    const enrolments = await this.enrol.listEnrolmentsForCourse(courseId);
    const activeUserIds = [...new Set(enrolments.filter((e) => e.status === 0).map((e) => e.userId))];
    const recipients: string[] = [];
    const allUsers = await db
      .selectFrom('users')
      .select(['id', 'suspended', 'deleted', 'is_guest as isGuest'])
      .execute();
    for (const u of allUsers) {
      if (u.suspended || u.deleted || u.isGuest) continue;
      if (await this.evaluator.hasCapability(u.id, 'analytics:viewinsights', ctxId)) recipients.push(u.id);
    }
    let predictions = 0; let insightCount = 0;
    for (const userId of activeUserIds) {
      const values: Record<string, number> = {};
      let score = 0;
      for (const indName of providerDef.indicators) {
        const ind = this.indicators.get(indName);
        if (!ind) continue;
        const v = await ind.calculate(userId, courseId);
        values[indName] = v;
        score += v;
      }
      score = providerDef.indicators.length ? score / providerDef.indicators.length : 0;
      if (score < 0.6) continue;
      const prediction = await this.repo.insertPrediction({
        modelId: model.id, userId: userId, contextId: ctxId, courseId: courseId, score, data: values,
      });
      predictions++;
      for (const recipientId of recipients) {
        await this.repo.insertInsight({
          modelId: model.id, predictionId: prediction.id, userId: userId, recipientId,
          contextId: ctxId, courseId: courseId, heading: 'Student at risk', data: { score, indicators: values },
        });
        insightCount++;
      }
    }
    return { predictions, insights: insightCount };
  }

  async listInsightsFor(userId: string): Promise<InsightRow[]> {
    const rows = await this.repo.listInsightsForRecipient(userId);
    const out: InsightRow[] = [];
    for (const row of rows) {
      if (await this.evaluator.hasCapability(userId, 'analytics:viewinsights', row.contextId)) out.push(row);
    }
    return out;
  }
  async listAllInsights(actorId: string): Promise<InsightRow[]> {
    const rows = await this.repo.listInsights();
    const out: InsightRow[] = [];
    for (const row of rows) {
      if (await this.evaluator.hasCapability(actorId, 'analytics:viewinsights', row.contextId)) out.push(row);
    }
    return out;
  }
}
