import { CONTEXT_LEVELS } from './contexts';
import { RoleContextConflictError } from './errors';
import { TEACHING_ROLE_ARCHETYPES } from './plan-limits';
import type { EnrolDatabase, PlatformScopeRunner } from './types';

const ENROL_ASSIGNMENT_COMPONENT_VALUE = 'enrol';

const ENROL_ACTIVE_STATUS = 0;

export interface RoleConflictAuditEntry {
  userId: string;
  username: string;
  email: string;
  conflictingCourseIds: string[];
  teachingOnlyCourseCount: number;
  learnerOnlyCourseCount: number;
}

export interface RoleConflictAuditReport {
  sameCourse: RoleConflictAuditEntry[];
  crossCourse: RoleConflictAuditEntry[];
}

export class RoleSeparationCore {
  constructor(
    private readonly db: EnrolDatabase,
    private readonly runInPlatformScope: PlatformScopeRunner,
  ) {}

  private async withPlatformRead<T>(fn: () => Promise<T>): Promise<T> {
    return this.runInPlatformScope(fn);
  }

  async hasTeachingCoverageForCourse(userId: string, courseId: string): Promise<boolean> {
    return this.withPlatformRead(async () => {
      const courseCtx = await this.db
        .selectFrom('context')
        .select('context.path')
        .where((eb) => eb.and([
          eb('context.context_level', '=', CONTEXT_LEVELS.COURSE),
          eb('context.instance_id', '=', courseId),
        ]))
        .executeTakeFirst();
      if (!courseCtx) return false;
      const ancestorIds = courseCtx.path.split('/').filter(Boolean);
      if (!ancestorIds.length) return false;
      const ancestorRows = await this.db
        .selectFrom('context')
        .select(['context.id as id', 'context.context_level as contextLevel'])
        .where('context.id', 'in', ancestorIds)
        .execute();
      const coveringIds = ancestorRows.filter((r) => r.contextLevel !== CONTEXT_LEVELS.SYSTEM).map((r) => r.id);
      if (!coveringIds.length) return false;
      const rows = await this.db
        .selectFrom('role_assignments')
        .select('role_assignments.id')
        .innerJoin('role', 'role.id', 'role_assignments.role_id')
        .where((eb) => eb.and([
          eb('role_assignments.user_id', '=', userId),
          eb('role_assignments.context_id', 'in', coveringIds),
          eb('role.archetype', 'in', [...TEACHING_ROLE_ARCHETYPES]),
          eb('role_assignments.component', '<>', ENROL_ASSIGNMENT_COMPONENT_VALUE),
        ]))
        .execute();
      return rows.length > 0;
    });
  }

  async hasActiveLearnerEnrolment(userId: string, courseId: string): Promise<boolean> {
    return this.withPlatformRead(async () => {
      const rows = await this.db
        .selectFrom('user_enrolments')
        .select('user_enrolments.id')
        .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
        .leftJoin('role', 'role.id', 'enrol.role_id')
        .where((eb) => eb.and([
          eb('user_enrolments.user_id', '=', userId),
          eb('enrol.course_id', '=', courseId),
          eb('user_enrolments.status', '=', ENROL_ACTIVE_STATUS),
          eb.or([
            eb('role.archetype', 'is', null),
            eb('role.archetype', 'not in', [...TEACHING_ROLE_ARCHETYPES]),
          ]),
        ]))
        .execute();
      return rows.length > 0;
    });
  }

  async isLearnerGrantRole(roleId: string | null): Promise<boolean> {
    if (!roleId) return true;
    return this.withPlatformRead(async () => {
      const row = await this.db
        .selectFrom('role')
        .select('role.archetype')
        .where('role.id', '=', roleId)
        .executeTakeFirst();
      return !(TEACHING_ROLE_ARCHETYPES as readonly string[]).includes(row?.archetype ?? '');
    });
  }

  async assertLearnerEnrolmentAllowed(userId: string, courseId: string): Promise<void> {
    if (await this.hasTeachingCoverageForCourse(userId, courseId)) {
      throw new RoleContextConflictError(
        'User already holds a teaching role covering this course and cannot be enrolled in it as a learner',
      );
    }
  }

  async coursesFedByCohort(cohortId: string): Promise<string[]> {
    return this.withPlatformRead(async () => {
      const viaInstances = await this.db
        .selectFrom('enrol')
        .select('enrol.course_id as courseId')
        .where((eb) => eb.and([
          eb('enrol.enrol', '=', 'cohort'),
          eb('enrol.custom_int1', '=', cohortId),
        ]))
        .execute();
      const viaClasses = await this.db
        .selectFrom('course')
        .select('course.id')
        .innerJoin('classes', 'classes.id', 'course.class_id')
        .where('classes.cohort_id', '=', cohortId)
        .execute();
      return [...new Set([...viaInstances.map((r) => r.courseId), ...viaClasses.map((r) => r.id)])];
    });
  }

  async assertCohortMembershipAllowed(userId: string, cohortId: string): Promise<void> {
    const courseIds = await this.coursesFedByCohort(cohortId);
    for (const courseId of courseIds) await this.assertLearnerEnrolmentAllowed(userId, courseId);
  }

  async coveredCoursesForContext(contextId: string): Promise<string[]> {
    return this.withPlatformRead(async () => {
      const ctx = await this.db
        .selectFrom('context')
        .select(['context.context_level as contextLevel', 'context.instance_id as instanceId'])
        .where('context.id', '=', contextId)
        .executeTakeFirst();
      if (!ctx || !ctx.instanceId) return [];
      if (ctx.contextLevel === CONTEXT_LEVELS.COURSE) return [ctx.instanceId];
      if (ctx.contextLevel === CONTEXT_LEVELS.CLASS) {
        const rows = await this.db
          .selectFrom('course')
          .select('course.id')
          .where('course.class_id', '=', ctx.instanceId)
          .execute();
        return rows.map((r) => r.id);
      }
      return [];
    });
  }

  async assertTeachingAssignmentAllowed(userId: string, contextId: string): Promise<void> {
    const courseIds = await this.coveredCoursesForContext(contextId);
    for (const courseId of courseIds) {
      if (await this.hasActiveLearnerEnrolment(userId, courseId)) {
        throw new RoleContextConflictError(
          'User is an active learner in a course covered by this context and cannot be assigned a teaching role there',
        );
      }
    }
  }

  async auditRoleConflicts(): Promise<RoleConflictAuditReport> {
    return this.withPlatformRead(async () => {
      const contextRows = await this.db
        .selectFrom('context')
        .select([
          'context.id as id',
          'context.context_level as contextLevel',
          'context.instance_id as instanceId',
          'context.path as path',
        ])
        .execute();
      const systemContextId = contextRows.find((r) => r.contextLevel === CONTEXT_LEVELS.SYSTEM)?.id;
      const coveringContextsByCourse = new Map<string, Set<string>>();
      for (const row of contextRows) {
        if (row.contextLevel === CONTEXT_LEVELS.COURSE && row.instanceId) {
          coveringContextsByCourse.set(
            row.instanceId,
            new Set(row.path.split('/').filter(Boolean).filter((id) => id !== systemContextId)),
          );
        }
      }
      const teachingAssignments = await this.db
        .selectFrom('role_assignments')
        .select([
          'role_assignments.user_id as userId',
          'role_assignments.context_id as contextId',
        ])
        .innerJoin('role', 'role.id', 'role_assignments.role_id')
        .where((eb) => eb.and([
          eb('role.archetype', 'in', [...TEACHING_ROLE_ARCHETYPES]),
          eb('role_assignments.component', '<>', ENROL_ASSIGNMENT_COMPONENT_VALUE),
        ]))
        .execute();
      const teachingContextsByUser = new Map<string, Set<string>>();
      for (const row of teachingAssignments) {
        const set = teachingContextsByUser.get(row.userId) ?? new Set<string>();
        set.add(row.contextId);
        teachingContextsByUser.set(row.userId, set);
      }
      const coveredCoursesByUser = new Map<string, Set<string>>();
      for (const [userId, contextIds] of teachingContextsByUser) {
        const covered = new Set<string>();
        for (const [courseId, covering] of coveringContextsByCourse) {
          for (const ctxId of contextIds) {
            if (covering.has(ctxId)) { covered.add(courseId); break; }
          }
        }
        if (covered.size) coveredCoursesByUser.set(userId, covered);
      }
      const learnerRows = await this.db
        .selectFrom('user_enrolments')
        .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
        .leftJoin('role', 'role.id', 'enrol.role_id')
        .select([
          'user_enrolments.user_id as userId',
          'enrol.course_id as courseId',
        ])
        .where((eb) => eb.and([
          eb('user_enrolments.status', '=', ENROL_ACTIVE_STATUS),
          eb.or([
            eb('role.archetype', 'is', null),
            eb('role.archetype', 'not in', [...TEACHING_ROLE_ARCHETYPES]),
          ]),
        ]))
        .execute();
      const learnerCoursesByUser = new Map<string, Set<string>>();
      for (const row of learnerRows) {
        const set = learnerCoursesByUser.get(row.userId) ?? new Set<string>();
        set.add(row.courseId);
        learnerCoursesByUser.set(row.userId, set);
      }
      const candidateIds = [...coveredCoursesByUser.keys()].filter((userId) => learnerCoursesByUser.has(userId));
      if (!candidateIds.length) return { sameCourse: [], crossCourse: [] };
      const userRows = await this.db
        .selectFrom('users')
        .select(['users.id as id', 'users.username as username', 'users.email as email'])
        .where('users.id', 'in', candidateIds)
        .execute();
      const displayById = new Map(userRows.map((u) => [u.id, u]));
      const sameCourse: RoleConflictAuditEntry[] = [];
      const crossCourse: RoleConflictAuditEntry[] = [];
      for (const userId of candidateIds) {
        const covered = coveredCoursesByUser.get(userId)!;
        const learning = learnerCoursesByUser.get(userId)!;
        const conflicting = [...covered].filter((courseId) => learning.has(courseId)).sort();
        const display = displayById.get(userId);
        const entry: RoleConflictAuditEntry = {
          userId,
          username: display?.username ?? '',
          email: display?.email ?? '',
          conflictingCourseIds: conflicting,
          teachingOnlyCourseCount: [...covered].filter((courseId) => !learning.has(courseId)).length,
          learnerOnlyCourseCount: [...learning].filter((courseId) => !covered.has(courseId)).length,
        };
        if (conflicting.length) sameCourse.push(entry);
        else crossCourse.push(entry);
      }
      const byUsername = (a: RoleConflictAuditEntry, b: RoleConflictAuditEntry): number => a.username.localeCompare(b.username);
      return { sameCourse: sameCourse.sort(byUsername), crossCourse: crossCourse.sort(byUsername) };
    });
  }
}
