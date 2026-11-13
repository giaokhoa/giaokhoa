import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { sql, type CentreDB } from '@giaokhoa/db';
import { type EnrolInstanceRow } from '@giaokhoa/enrol';
import { SpaceDatabaseService } from '../db/routing/space-database.service';
import { TaskLogService } from '../task-log.service';
import { tenantAls } from '../db/tenant-als';

const ENROL_COLUMNS = [
  'id',
  'course_id as courseId',
  'enrol',
  'name',
  'role_id as roleId',
  'status',
  'enrol_period as enrolPeriod',
  'time_start as timeStart',
  'time_end as timeEnd',
  'enrolment_key as enrolmentKey',
  'custom_int1 as customInt1',
  'custom_int2 as customInt2',
  'custom_text1 as customText1',
  'cost',
  'currency',
  'payment_account_id as paymentAccountId',
  'send_welcome_message as sendWelcomeMessage',
  'welcome_message as welcomeMessage',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const USER_ENROLMENT_PLAN_COLUMNS = [
  'id',
  'enrol_id as enrolId',
  'user_id as userId',
  'status',
  'modifier_id as modifierId',
] as const;

interface ReconcileClassRow {
  id: string;
  tenantId: string;
  cohortId: string;
}

export interface ClassEnrolReconcileResult {
  checkedAt: string;
  classesChecked: number;
  enrolled: number;
  reactivated: number;
  suspended: number;
  withdrawn: number;
  rolesRestored: number;
  skippedClassIds: string[];
}

export const RECONCILE_MAX_FIX_RATIO = 0.2;
export const RECONCILE_MIN_FIX_ALLOWANCE = 5;

const ENROL_ACTIVE = 0;
const ENROL_SUSPENDED = 1;
const ENROL_WITHDRAWN = 2;
const ENROL_ASSIGNMENT_COMPONENT = 'enrol';
const CONTEXT_LEVEL_COURSE = 50;

interface PlannedFix {
  kind: 'enrol' | 'reactivate' | 'suspend' | 'withdraw' | 'role';
  instance: EnrolInstanceRow;
  userId: string;
  ueId?: string;
}

@Processor('class-enrol-reconcile')
export class ClassEnrolReconcileProcessor extends WorkerHost {
  constructor(private readonly spaceDb: SpaceDatabaseService, private readonly taskLog: TaskLogService) { super(); }

  async process(_job: Job): Promise<ClassEnrolReconcileResult> {
    void _job;
    return tenantAls.run({ platform: true }, () => this.processInContext());
  }

  private async processInContext(): Promise<ClassEnrolReconcileResult> {
    return this.spaceDb.sweepSharedAndDedicated(() =>
      this.taskLog.run('class-enrol-reconcile', () => this.sweep(), (r) =>
        `classes ${r.classesChecked}, enrolled ${r.enrolled}, reactivated ${r.reactivated}, suspended ${r.suspended}, withdrawn ${r.withdrawn}, roles ${r.rolesRestored}, skipped ${r.skippedClassIds.length}`), (a, b) => ({
          checkedAt: a.checkedAt,
          classesChecked: a.classesChecked + b.classesChecked,
          enrolled: a.enrolled + b.enrolled,
          reactivated: a.reactivated + b.reactivated,
          suspended: a.suspended + b.suspended,
          withdrawn: a.withdrawn + b.withdrawn,
          rolesRestored: a.rolesRestored + b.rolesRestored,
          skippedClassIds: [...a.skippedClassIds, ...b.skippedClassIds],
        }));
  }

  private async sweep(): Promise<ClassEnrolReconcileResult> {
    const now = new Date();
    const result: ClassEnrolReconcileResult = {
      checkedAt: now.toISOString(),
      classesChecked: 0, enrolled: 0, reactivated: 0, suspended: 0, withdrawn: 0,
      rolesRestored: 0, skippedClassIds: [],
    };
    const activeClasses = await this.spaceDb.routedKysely
      .selectFrom('classes')
      .select(['id', 'tenant_id as tenantId', 'cohort_id as cohortId'])
      .where('status', '=', 'active')
      .execute();
    for (const clazz of activeClasses) {
      result.classesChecked += 1;
      await tenantAls.run({ ...tenantAls.getStore(), platform: false, tenantId: clazz.tenantId }, async () => {
        const fixes = await this.planForClass(clazz);
        if (fixes === null) return;
        const scale = fixes.scale;
        if (fixes.planned.length > Math.max(RECONCILE_MIN_FIX_ALLOWANCE, Math.floor(scale * RECONCILE_MAX_FIX_RATIO))) {
          result.skippedClassIds.push(clazz.id);
          return;
        }
        for (const fix of fixes.planned) {
          await this.applyFix(fix, now);
          if (fix.kind === 'enrol') result.enrolled += 1;
          else if (fix.kind === 'reactivate') result.reactivated += 1;
          else if (fix.kind === 'suspend') result.suspended += 1;
          else if (fix.kind === 'withdraw') result.withdrawn += 1;
          else if (fix.kind === 'role') result.rolesRestored += 1;
        }
      });
    }
    return result;
  }

  private async planForClass(clazz: ReconcileClassRow): Promise<{ planned: PlannedFix[]; scale: number } | null> {
    const members = await this.spaceDb.routedKysely
      .selectFrom('cohort_members')
      .select('user_id as userId')
      .where('cohort_id', '=', clazz.cohortId)
      .execute();
    const memberIds = new Set(members.map((m) => m.userId));
    const classCourses = await this.spaceDb.routedKysely
      .selectFrom('course')
      .select('id')
      .where('class_id', '=', clazz.id)
      .execute();
    if (classCourses.length === 0) return { planned: [], scale: memberIds.size };
    const instances: EnrolInstanceRow[] = await this.spaceDb.routedKysely
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('course_id', 'in', classCourses.map((c) => c.id))
      .where('enrol', '=', 'cohort')
      .where('custom_int1', '=', clazz.cohortId)
      .where('status', '=', 0)
      .execute();
    const planned: PlannedFix[] = [];
    let scale = memberIds.size;
    for (const instance of instances) {
      const ues = await this.spaceDb.routedKysely
        .selectFrom('user_enrolments')
        .select(USER_ENROLMENT_PLAN_COLUMNS)
        .where('enrol_id', '=', instance.id)
        .execute();
      scale += ues.length;
      const ueByUser = new Map(ues.map((ue) => [ue.userId, ue]));
      const courseCtx = await this.courseContextId(instance.courseId);
      const assignedUserIds = new Set<string>();
      if (instance.roleId && courseCtx && memberIds.size > 0) {
        const assignments = await this.spaceDb.routedKysely
          .selectFrom('role_assignments')
          .select('user_id as userId')
          .where('user_id', 'in', [...memberIds])
          .where('context_id', '=', courseCtx)
          .where('role_id', '=', instance.roleId)
          .where('component', '=', ENROL_ASSIGNMENT_COMPONENT)
          .where('item_id', '=', instance.id)
          .execute();
        for (const assignment of assignments) assignedUserIds.add(assignment.userId);
      }
      for (const userId of memberIds) {
        const ue = ueByUser.get(userId);
        if (!ue) {
          planned.push({ kind: 'enrol', instance, userId });
          continue;
        }
        if (ue.status === ENROL_WITHDRAWN) {
          planned.push({ kind: 'reactivate', instance, userId, ueId: ue.id });
          continue;
        }
        if (ue.status === ENROL_SUSPENDED) {
          if (ue.modifierId !== null) continue;
          planned.push({ kind: 'reactivate', instance, userId, ueId: ue.id });
          continue;
        }
        if (instance.roleId && courseCtx) {
          if (!assignedUserIds.has(userId)) planned.push({ kind: 'role', instance, userId, ueId: ue.id });
        }
      }
      for (const ue of ues) {
        if (memberIds.has(ue.userId)) continue;
        if (ue.status === ENROL_ACTIVE) {
          planned.push({ kind: instance.customText1 === 'unenrol' ? 'withdraw' : 'suspend', instance, userId: ue.userId, ueId: ue.id });
        } else if (ue.status === ENROL_SUSPENDED && ue.modifierId === null && instance.customText1 === 'unenrol') {
          planned.push({ kind: 'withdraw', instance, userId: ue.userId, ueId: ue.id });
        }
      }
    }
    return { planned, scale };
  }

  private async courseContextId(courseId: string): Promise<string | undefined> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', CONTEXT_LEVEL_COURSE)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    return row?.id;
  }

  private async applyFix(fix: PlannedFix, now: Date): Promise<void> {
    const { instance, userId } = fix;
    if (fix.kind === 'enrol') {
      const courseCtx = await this.courseContextId(instance.courseId);
      await this.spaceDb.routedKysely.transaction().execute(async (tx) => {
        await tx.insertInto('user_enrolments').values({
          enrol_id: instance.id, user_id: userId, status: ENROL_ACTIVE, time_start: now, time_end: null, modifier_id: null,
        }).execute();
        await tx.insertInto('outbox_events').values({
          aggregate: 'enrol', type: 'user_enrolled',
          payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
            courseId: instance.courseId, userId, instanceId: instance.id, method: 'cohort', actorId: null, reconciled: true,
          })}::jsonb`,
        }).execute();
        if (instance.roleId && courseCtx) {
          await tx.insertInto('role_assignments').values({
            role_id: instance.roleId, user_id: userId, context_id: courseCtx,
            component: ENROL_ASSIGNMENT_COMPONENT, item_id: instance.id,
          }).onConflict((oc) => oc.doNothing()).execute();
        }
        if (instance.customInt2) {
          await tx.insertInto('groups_members').values({
            group_id: instance.customInt2, user_id: userId, component: 'enrol_cohort', item_id: instance.id,
          }).onConflict((oc) => oc.doNothing()).execute();
        }
      });
      return;
    }
    if (fix.kind === 'reactivate' && fix.ueId) {
      await this.spaceDb.routedKysely.updateTable('user_enrolments')
        .set({ status: ENROL_ACTIVE, modifier_id: null, updated_at: now })
        .where('id', '=', fix.ueId)
        .execute();
      return;
    }
    if (fix.kind === 'suspend' && fix.ueId) {
      await this.spaceDb.routedKysely.transaction().execute(async (tx) => {
        await tx.updateTable('user_enrolments')
          .set({ status: ENROL_SUSPENDED, modifier_id: null, updated_at: now })
          .where('id', '=', fix.ueId!)
          .execute();
        await tx.insertInto('outbox_events').values({
          aggregate: 'enrol', type: 'user_enrolment_suspended',
          payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
            courseId: instance.courseId, userId, instanceId: instance.id, reason: 'reconciled_cohort_removed',
          })}::jsonb`,
        }).execute();
      });
      return;
    }
    if (fix.kind === 'withdraw' && fix.ueId) {
      const courseCtx = await this.courseContextId(instance.courseId);
      await this.spaceDb.routedKysely.transaction().execute(async (tx) => {
        await tx.updateTable('user_enrolments')
          .set({ status: ENROL_WITHDRAWN, modifier_id: null, updated_at: now })
          .where('id', '=', fix.ueId!)
          .execute();
        if (instance.roleId && courseCtx) {
          await tx.deleteFrom('role_assignments')
            .where('user_id', '=', userId)
            .where('context_id', '=', courseCtx)
            .where('role_id', '=', instance.roleId)
            .where('component', '=', ENROL_ASSIGNMENT_COMPONENT)
            .where('item_id', '=', instance.id)
            .execute();
        }
        await tx.insertInto('outbox_events').values({
          aggregate: 'enrol', type: 'user_unenrolled',
          payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
            courseId: instance.courseId, userId, instanceId: instance.id, reason: 'reconciled_cohort_removed',
          })}::jsonb`,
        }).execute();
      });
      return;
    }
    if (fix.kind === 'role') {
      const courseCtx = await this.courseContextId(instance.courseId);
      if (instance.roleId && courseCtx) {
        await this.spaceDb.routedKysely.insertInto('role_assignments').values({
          role_id: instance.roleId, user_id: userId, context_id: courseCtx,
          component: ENROL_ASSIGNMENT_COMPONENT, item_id: instance.id,
        }).onConflict((oc) => oc.doNothing()).execute();
      }
    }
  }
}
