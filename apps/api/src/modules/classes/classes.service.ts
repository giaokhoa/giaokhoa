import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  AddRosterStudentResult,
  ClassJoinRequest as ClassJoinRequestView,
  ClassListItem,
  ClassOverview,
  ClassPublicView,
  ClassRosterImportReport,
  ClassRosterMember,
  ClassStaffRole,
  ClassStaffView,
  ClassSuspendedMember,
  ClassView,
  ClassViewerRole,
  CreateClass,
  JoinClassResult,
  RosterStudentIdentity,
  UpdateClass,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import type { CentreTx } from '@giaokhoa/db';
import { tenantAls } from '../tenants/tenant-als';
import type { ContextRow } from '@giaokhoa/db/repositories/access';
import { GroupsRepository } from '@giaokhoa/db/repositories/groups';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { CAP_ALLOW } from '../access/domain/permission';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { RolesService } from '../access/roles.service';
import type { CourseRow } from '@giaokhoa/db/repositories/courses';
import { CoursesService } from '../courses/courses.service';
import { EnrolService } from '../enrol/enrol.service';
import { GroupsService } from '../groups/groups.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import type { UserRow } from '@giaokhoa/db/repositories/users';
import { CLASS_WHOLE_GROUP_NAME, ClassesRepository, type ClassJoinRequestRow, type ClassRow } from '@giaokhoa/db/repositories/classes';

export type { ClassRow };

export const CLASS_OWNER_ROLE = 'editingteacher';
export const CLASS_ASSIGNER_ROLE = 'classassigner';
export const CLASS_GRADER_ROLE = 'classgrader';
export const CLASS_ROSTER_MANAGER_ROLE = 'classrostermanager';

const CLASS_ROLE_DEFS = [
  { shortName: CLASS_ASSIGNER_ROLE, name: 'Class work assigner', description: 'Đồng GV được giao bài / tạo khoá trong lớp (quyền 1 kiểu Azota).' },
  { shortName: CLASS_GRADER_ROLE, name: 'Class grader', description: 'Đồng GV được xem và chấm bài trong các khoá của lớp (quyền 2 kiểu Azota).' },
  { shortName: CLASS_ROSTER_MANAGER_ROLE, name: 'Class roster manager', description: 'Đồng GV được quản lý danh sách học sinh của lớp (quyền 3 kiểu Azota).' },
] as const;

const CLASS_ROLE_GRANTS: Record<string, string[]> = {
  [CLASS_OWNER_ROLE]: [
    'class:view', 'class:update', 'class:delete', 'class:manageroster', 'class:assignwork', 'class:grade', 'class:share',
    'course:create', 'course:update', 'course:manageactivities', 'cohort:manage', 'cohort:view',
  ],
  [CLASS_ASSIGNER_ROLE]: ['class:view', 'class:assignwork', 'course:create', 'course:update', 'course:manageactivities'],
  [CLASS_GRADER_ROLE]: [
    'class:view', 'class:grade',
    'grade:viewall', 'grade:edit', 'assign:viewallsubmissions', 'assign:grade',
    'quiz:view', 'quiz:grade', 'quiz:viewreports',
  ],
  [CLASS_ROSTER_MANAGER_ROLE]: ['class:view', 'class:manageroster', 'cohort:manage', 'cohort:view'],
};

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateJoinCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
}

export function toClassDto(row: ClassRow, canSeeJoinCode: boolean): ClassView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    schoolYear: row.schoolYear,
    ownerId: row.ownerId,
    cohortId: row.cohortId,
    allowSelfReport: row.allowSelfReport,
    joinCode: canSeeJoinCode ? row.joinCode : null,
    joinAutoApprove: row.joinAutoApprove,
    onLeave: row.onLeave as ClassView['onLeave'],
    status: row.status as ClassView['status'],
    description: row.description,
    feeCost: row.feeCost,
    feeCurrency: row.feeCurrency,
    feePaymentAccountId: row.feePaymentAccountId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ClassFeeTarget {
  classId: string;
  tenantId: string;
  feeCost: number;
  feeCurrency: string;
  feePaymentAccountId: string | null;
}

@Injectable()
export class ClassesService implements OnModuleInit {
  constructor(
    private readonly repo: ClassesRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly roles: RolesService,
    private readonly courses: CoursesService,
    private readonly groups: GroupsService,
    private readonly enrol: EnrolService,
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
    private readonly tenantContext: TenantContextService,
    private readonly outbox: OutboxService,
    private readonly groupsRepo: GroupsRepository,
  ) {}

  onModuleInit(): void {
    this.courses.registerClassHook({
      resolveClass: (classId, tenantId) => this.resolveClass(classId, tenantId),
      onCourseCreated: (course) => this.onCourseCreated(course),
    });
  }


  private async effectiveTenantId(): Promise<string> {
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }

  private async classContextId(classId: string): Promise<string> {
    const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.CLASS, classId);
    if (!ctx) throw new NotFoundException({ message: `No context for class ${classId}`, code: 'class.context_missing' });
    return ctx.id;
  }

  async getClassRow(id: string): Promise<ClassRow> {
    const row = await this.repo.getClass(id);
    const tenantId = await this.effectiveTenantId();
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException({ message: `Class ${id} not found`, code: 'class.not_found' });
    }
    return row;
  }

  private async canSeeJoinCode(actorId: string, row: ClassRow, knownCtxId?: string): Promise<boolean> {
    if (actorId === row.ownerId) return true;
    const ctxId = knownCtxId ?? (await this.classContextId(row.id));
    return this.evaluator.hasCapability(actorId, 'class:manageroster', ctxId);
  }

  private async canViewClass(actorId: string, row: ClassRow): Promise<boolean> {
    if (actorId === row.ownerId) return true;
    const ctxId = await this.classContextId(row.id);
    if (await this.evaluator.hasCapability(actorId, 'class:view', ctxId)) return true;
    return this.groups.isCohortMember(row.cohortId, actorId);
  }

  private async filterVisibleClasses(actorId: string, rows: ClassRow[]): Promise<ClassRow[]> {
    const evaluated: { row: ClassRow; ctx: ContextRow }[] = [];
    for (const row of rows) {
      if (row.ownerId === actorId) continue;
      const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.CLASS, row.id);
      if (!ctx) throw new NotFoundException({ message: `No context for class ${row.id}`, code: 'class.context_missing' });
      evaluated.push({ row, ctx });
    }
    const viewByClassId = new Map<string, boolean>();
    if (evaluated.length > 0) {
      const targets = evaluated.map((entry) => entry.ctx);
      const resolved = await this.evaluator.resolveCapabilitiesForContexts(
        actorId,
        targets,
        new Map(targets.map((c) => [c.id, c])),
      );
      for (const entry of evaluated) {
        viewByClassId.set(entry.row.id, (resolved.get(entry.ctx.id) ?? []).includes('class:view'));
      }
    }
    const visible: ClassRow[] = [];
    for (const row of rows) {
      if (row.ownerId === actorId || viewByClassId.get(row.id)) {
        visible.push(row);
        continue;
      }
      if (await this.groups.isCohortMember(row.cohortId, actorId)) visible.push(row);
    }
    return visible;
  }


  async createClass(actorId: string, input: CreateClass): Promise<ClassView> {
    const tenantId = await this.effectiveTenantId();
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    await this.evaluator.requireCapability(actorId, 'class:create', tenantCtx.id);
    const ownerId = input.ownerId ?? actorId;
    if (ownerId !== actorId) {
      await this.evaluator.requireCapability(actorId, 'tenant:manage', tenantCtx.id);
    }
    await this.users.getUser(ownerId);
    if (input.code && (await this.repo.getClassByCode(tenantId, input.code))) {
      throw new ConflictException({ message: `Class code ${input.code} is taken in this tenant`, code: 'class.code_taken' });
    }
    await this.tenants.ensureActiveMembership(tenantId, ownerId);
    await this.ensureClassRoles();

    const row = await this.repo.transaction(async (tx) => {
      const cohortRow = await this.groupsRepo.insertCohort({
        tenantId,
        name: input.name,
        idNumber: '',
        description: '',
        contextId: tenantCtx.id,
        component: 'class',
        visible: false,
      }, tx);
      const classRow = await this.repo.insertClass({
        tenantId,
        name: input.name,
        code: input.code ?? null,
        schoolYear: input.schoolYear ?? null,
        ownerId,
        cohortId: cohortRow.id,
        allowSelfReport: false,
        joinCode: null,
        onLeave: 'suspend',
        status: 'active',
        description: input.description ?? '',
      }, tx);
      const classCtx = await this.contexts.createContext(CONTEXT_LEVELS.CLASS, classRow.id, tenantCtx.id, tx);
      await this.groupsRepo.updateCohort(cohortRow.id, { contextId: classCtx.id }, tx);
      await this.applyClassRoleGrants(classCtx.id, actorId, tx);
      const ownerRole = await this.roles.getRoleByShortname(CLASS_OWNER_ROLE);
      if (!ownerRole) throw new Error('editingteacher role not seeded');
      await this.roles.assignRole(ownerId, ownerRole.id, classCtx.id, actorId, undefined, tx);
      await this.outbox.enqueueKysely(tx, {
        aggregate: 'class', type: 'class_created',
        payload: { classId: classRow.id, tenantId, ownerId, actorId },
        tenantId,
      });
      return classRow;
    });
    return toClassDto(row, true);
  }

  private async ensureClassRoles(): Promise<void> {
    for (const def of CLASS_ROLE_DEFS) {
      if (!(await this.roles.getRoleByShortname(def.shortName))) {
        await this.roles.createRole({ name: def.name, shortName: def.shortName, description: def.description, archetype: 'teacher' });
      }
    }
  }

  private async applyClassRoleGrants(classContextId: string, modifierId: string, tx?: CentreTx): Promise<void> {
    for (const [shortName, caps] of Object.entries(CLASS_ROLE_GRANTS)) {
      const role = await this.roles.getRoleByShortname(shortName);
      if (!role) continue;
      for (const cap of caps) {
        await this.roles.setCapabilityOverride(role.id, cap, classContextId, CAP_ALLOW, modifierId, tx);
      }
    }
  }

  async listClasses(actorId: string): Promise<ClassListItem[]> {
    const tenantId = await this.effectiveTenantId();
    const rows = await this.repo.listClassesByTenant(tenantId);
    const tenantCtx = await this.contexts.getTenantContext(tenantId);
    const seesAll = (await this.evaluator.isSiteAdmin(actorId))
      || (tenantCtx ? await this.evaluator.hasCapability(actorId, 'tenant:manage', tenantCtx.id) : false);
    const canCreate = tenantCtx ? await this.evaluator.hasCapability(actorId, 'class:create', tenantCtx.id) : false;
    const visible = seesAll ? rows : await this.filterVisibleClasses(actorId, rows);
    return Promise.all(visible.map(async (row) => {
      const ctxId = await this.classContextId(row.id);
      const isOwner = actorId === row.ownerId;
      const canUpdate = isOwner || (await this.evaluator.hasCapability(actorId, 'class:update', ctxId));
      const canManageRoster = isOwner || (await this.evaluator.hasCapability(actorId, 'class:manageroster', ctxId));
      const canDelete = (isOwner || (tenantCtx ? await this.evaluator.hasCapability(actorId, 'tenant:manage', tenantCtx.id) : false))
        && (isOwner || (await this.evaluator.hasCapability(actorId, 'class:delete', ctxId)));
      return {
        ...toClassDto(row, await this.canSeeJoinCode(actorId, row, ctxId)),
        canCreate,
        canUpdate,
        canDelete,
        canManageRoster,
      };
    }));
  }

  async getClass(actorId: string, id: string): Promise<ClassView> {
    const row = await this.getClassRow(id);
    if (!(await this.canViewClass(actorId, row))) {
      throw new NotFoundException({ message: `Class ${id} not found`, code: 'class.not_found' });
    }
    return toClassDto(row, await this.canSeeJoinCode(actorId, row));
  }

  async getClassOverview(actorId: string, id: string): Promise<Omit<ClassOverview, 'courses'> & { courses: CourseRow[] }> {
    const row = await this.getClassRow(id);
    if (!(await this.canViewClass(actorId, row))) {
      throw new NotFoundException({ message: `Class ${id} not found`, code: 'class.not_found' });
    }
    const ctxId = await this.classContextId(id);
    const isOwner = actorId === row.ownerId;
    const canManageRoster = isOwner || (await this.evaluator.hasCapability(actorId, 'class:manageroster', ctxId));
    const canShare = isOwner || (await this.evaluator.hasCapability(actorId, 'class:share', ctxId));

    const staffRoleIds = new Set<string>();
    for (const shortName of [CLASS_ASSIGNER_ROLE, CLASS_GRADER_ROLE, CLASS_ROSTER_MANAGER_ROLE]) {
      const role = await this.roles.getRoleByShortname(shortName);
      if (role) staffRoleIds.add(role.id);
    }
    type AssignmentRow = { userId: string; roleId: string; component: string };
    const assignments = (await this.roles.listAssignments({ contextId: ctxId })) as unknown as AssignmentRow[];
    const hasStaffRole = assignments.some((a) => a.component === '' && a.userId === actorId && staffRoleIds.has(a.roleId));
    const isMember = await this.groups.isCohortMember(row.cohortId, actorId);

    const viewerRole: ClassViewerRole = isOwner
      ? 'owner'
      : hasStaffRole || canManageRoster || canShare
        ? 'staff'
        : isMember
          ? 'member'
          : 'staff';

    const allCourses = await this.repo.listCoursesInClass(id);
    let courses = allCourses;
    if (viewerRole === 'member') {
      const activeIds = new Set(await this.repo.listActiveEnrolledCourseIds(id, actorId));
      courses = allCourses.filter((c) => activeIds.has(c.id));
    }
    const rosterCount = (await this.groups.listCohortMembers(row.cohortId)).length;
    return {
      class: toClassDto(row, await this.canSeeJoinCode(actorId, row)),
      viewerRole,
      canManageRoster,
      canShare,
      rosterCount,
      courses,
    };
  }

  async updateClass(actorId: string, id: string, input: UpdateClass): Promise<ClassView> {
    const row = await this.getClassRow(id);
    const ctxId = await this.classContextId(id);
    await this.evaluator.requireCapability(actorId, 'class:update', ctxId);
    const patch: Partial<ClassRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.code !== undefined) {
      if (input.code !== null && input.code !== row.code) {
        const taken = await this.repo.getClassByCode(row.tenantId, input.code);
        if (taken && taken.id !== id) {
          throw new ConflictException({ message: `Class code ${input.code} is taken in this tenant`, code: 'class.code_taken' });
        }
      }
      patch.code = input.code;
    }
    if (input.schoolYear !== undefined) patch.schoolYear = input.schoolYear;
    if (input.description !== undefined) patch.description = input.description;
    if (input.onLeave !== undefined) patch.onLeave = input.onLeave;
    if (input.allowSelfReport !== undefined) patch.allowSelfReport = input.allowSelfReport;
    if (input.joinAutoApprove !== undefined) patch.joinAutoApprove = input.joinAutoApprove;
    if (input.feeCost !== undefined) patch.feeCost = input.feeCost;
    if (input.feeCurrency !== undefined) patch.feeCurrency = input.feeCurrency.toUpperCase();
    if (input.feePaymentAccountId !== undefined) patch.feePaymentAccountId = input.feePaymentAccountId;
    if (input.rotateJoinCode || (patch.allowSelfReport === true && !row.joinCode)) {
      patch.joinCode = generateJoinCode();
    }
    if (patch.joinCode) {
      const taken = await this.repo.getClassByJoinCode(patch.joinCode);
      if (taken && taken.id !== id) {
        throw new ConflictException({ message: 'Class join code already exists in this store', code: 'class.join_code_taken' });
      }
    }
    if (Object.keys(patch).length) await this.repo.updateClass(id, patch);
    if (patch.onLeave !== undefined && patch.onLeave !== row.onLeave) {
      await this.repo.syncOnLeaveToInstances(row.cohortId, patch.onLeave);
    }
    const updated = (await this.repo.getClass(id))!;
    return toClassDto(updated, await this.canSeeJoinCode(actorId, updated));
  }

  async archiveClass(actorId: string, id: string): Promise<ClassView> {
    const row = await this.getClassRow(id);
    const ctxId = await this.classContextId(id);
    await this.evaluator.requireCapability(actorId, 'class:update', ctxId);
    if (row.status !== 'archived') {
      await this.repo.updateClass(id, { status: 'archived' });
      await this.outbox.enqueueStandalone({
        aggregate: 'class', type: 'class_archived',
        payload: { classId: id, tenantId: row.tenantId, actorId },
        tenantId: row.tenantId,
      });
    }
    const updated = (await this.repo.getClass(id))!;
    return toClassDto(updated, await this.canSeeJoinCode(actorId, updated));
  }

  async deleteClass(actorId: string, id: string): Promise<void> {
    const row = await this.getClassRow(id);
    const ctxId = await this.classContextId(id);
    await this.evaluator.requireCapability(actorId, 'class:delete', ctxId);
    if (actorId !== row.ownerId) {
      const tenantCtx = await this.contexts.ensureTenantContext(row.tenantId);
      await this.evaluator.requireCapability(actorId, 'tenant:manage', tenantCtx.id);
    }
    if ((await this.repo.countCoursesInClass(id)) > 0) {
      throw new ConflictException({ message: 'Class still has courses; archive or delete its courses first', code: 'class.has_courses' });
    }
    await this.repo.deleteClass(id);
    await this.repo.deleteCohort(row.cohortId);
    await this.contexts.deleteByLevelInstance(CONTEXT_LEVELS.CLASS, id);
    await this.outbox.enqueueStandalone({
      aggregate: 'class', type: 'class_deleted',
      payload: { classId: id, tenantId: row.tenantId, actorId },
      tenantId: row.tenantId,
    });
  }


  async listRoster(actorId: string, classId: string): Promise<ClassRosterMember[]> {
    const row = await this.getClassRow(classId);
    if (!(await this.canViewClass(actorId, row))) {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'class.not_found' });
    }
    const ctxId = await this.classContextId(classId);
    const canManageRoster = actorId === row.ownerId || (await this.evaluator.hasCapability(actorId, 'class:manageroster', ctxId));
    const members = await this.groups.listCohortMembers(row.cohortId);
    const usersById = new Map((await this.users.getUsersByIds(members.map((m) => m.userId))).map((u) => [u.id, u]));
    return members.map((m) => {
      const u = usersById.get(m.userId);
      return {
        userId: m.userId,
        timeAdded: m.timeAdded.toISOString(),
        firstName: u?.firstName ?? '',
        lastName: u?.lastName ?? '',
        username: canManageRoster ? (u?.username ?? '') : '',
        email: canManageRoster ? (u?.email ?? '') : '',
      };
    });
  }

  async addToRoster(actorId: string, classId: string, userId: string): Promise<void> {
    const row = await this.getClassRow(classId);
    if (row.status === 'archived') {
      throw new BadRequestException({ message: 'Class is archived; roster is frozen', code: 'class.archived' });
    }
    const ctxId = await this.classContextId(classId);
    await this.evaluator.requireCapability(actorId, 'class:manageroster', ctxId);
    await this.users.getUser(userId);
    await this.tenants.ensureActiveMembership(row.tenantId, userId);
    await this.groups.addCohortMember(actorId, row.cohortId, userId);
  }

  async removeFromRoster(actorId: string, classId: string, userId: string): Promise<void> {
    const row = await this.getClassRow(classId);
    if (row.status === 'archived') {
      throw new BadRequestException({ message: 'Class is archived; roster is frozen', code: 'class.archived' });
    }
    const ctxId = await this.classContextId(classId);
    await this.evaluator.requireCapability(actorId, 'class:manageroster', ctxId);
    await this.groups.removeCohortMember(actorId, row.cohortId, userId);
  }

  async listClassCourses(actorId: string, classId: string): Promise<CourseRow[]> {
    const row = await this.getClassRow(classId);
    if (!(await this.canViewClass(actorId, row))) {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'class.not_found' });
    }
    return this.repo.listCoursesInClass(classId);
  }


  private async requireRosterManager(actorId: string, row: ClassRow): Promise<void> {
    if (row.status === 'archived') {
      throw new BadRequestException({ message: 'Class is archived; roster is frozen', code: 'class.archived' });
    }
    const ctxId = await this.classContextId(row.id);
    await this.evaluator.requireCapability(actorId, 'class:manageroster', ctxId);
  }

  private displayNameOf(user: UserRow): string {
    const full = `${user.lastName} ${user.firstName}`.trim();
    return full || user.username;
  }

  private splitFullName(fullName: string): { firstName: string; lastName: string } {
    const tokens = fullName.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { firstName: '', lastName: '' };
    return { firstName: tokens[tokens.length - 1]!, lastName: tokens.slice(0, -1).join(' ') };
  }

  private generateTemporaryPassword(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(12);
    const core = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `GiaoKhoa@9${core}`;
  }

  private async uniqueUsername(base: string): Promise<string> {
    const stem = base || 'hocvien';
    let candidate = stem;
    let n = 1;
    while (await this.users.getByUsername(candidate)) {
      n += 1;
      candidate = `${stem}${n}`;
    }
    return candidate;
  }

  private async resolveStudentAccount(input: RosterStudentIdentity): Promise<{ user: UserRow; created: boolean; temporaryPassword: string | null }> {
    const email = input.email?.trim().toLowerCase() || undefined;
    const phone = input.phone ? input.phone.replace(/[^0-9]/g, '') || undefined : undefined;
    if (!email && !phone) {
      throw new BadRequestException({ message: 'A student row needs an email or a phone number to match or create an account', code: 'class.roster_identity_missing' });
    }
    let user = email ? await this.users.getByEmail(email) : undefined;
    if (!user && phone) user = await this.users.getByUsername(phone);
    if (user) return { user, created: false, temporaryPassword: null };
    const { firstName, lastName } = this.splitFullName(input.fullName);
    const localPart = email ? email.split('@')[0]!.replace(/[^a-z0-9._-]/g, '') : '';
    const username = await this.uniqueUsername(phone ?? localPart);
    const temporaryPassword = this.generateTemporaryPassword();
    const created = await this.users.createUser({
      username,
      email: email ?? `${username}@roster.local`,
      password: temporaryPassword,
      firstName,
      lastName,
      forcePasswordChange: true,
    });
    return { user: created, created: true, temporaryPassword };
  }

  private async addStudentByIdentity(row: ClassRow, actorId: string, input: RosterStudentIdentity): Promise<AddRosterStudentResult> {
    const { user, created, temporaryPassword } = await this.resolveStudentAccount(input);
    const already = await this.groups.isCohortMember(row.cohortId, user.id);
    if (!already) await this.addToRoster(actorId, row.id, user.id);
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: this.displayNameOf(user),
      outcome: already ? 'already_member' : created ? 'created' : 'matched',
      temporaryPassword: created ? temporaryPassword : null,
    };
  }

  async addRosterStudentByIdentity(actorId: string, classId: string, input: RosterStudentIdentity): Promise<AddRosterStudentResult> {
    const row = await this.getClassRow(classId);
    await this.requireRosterManager(actorId, row);
    return this.addStudentByIdentity(row, actorId, input);
  }

  async importRoster(actorId: string, classId: string, rows: RosterStudentIdentity[]): Promise<ClassRosterImportReport> {
    const row = await this.getClassRow(classId);
    await this.requireRosterManager(actorId, row);
    const results: ClassRosterImportReport['results'] = [];
    let added = 0;
    let created = 0;
    let alreadyMembers = 0;
    let failed = 0;
    for (const [i, input] of rows.entries()) {
      try {
        const r = await this.addStudentByIdentity(row, actorId, input);
        if (r.outcome === 'already_member') {
          alreadyMembers += 1;
          results.push({ row: i + 1, fullName: input.fullName, status: 'already_member', userId: r.userId, username: r.username, temporaryPassword: null, error: null });
        } else {
          added += 1;
          if (r.outcome === 'created') created += 1;
          results.push({ row: i + 1, fullName: input.fullName, status: r.outcome === 'created' ? 'added_created' : 'added_matched', userId: r.userId, username: r.username, temporaryPassword: r.temporaryPassword, error: null });
        }
      } catch (err) {
        failed += 1;
        const resp = err instanceof HttpException ? err.getResponse() : null;
        const body = (typeof resp === 'object' && resp !== null ? resp : {}) as { code?: unknown; message?: unknown };
        const error = typeof body.code === 'string' ? body.code : typeof body.message === 'string' ? body.message : 'class.roster_row_failed';
        results.push({ row: i + 1, fullName: input.fullName, status: 'error', userId: null, username: null, temporaryPassword: null, error });
      }
    }
    return { total: rows.length, added, created, alreadyMembers, failed, results };
  }

  async parseRosterWorkbook(buffer: Buffer): Promise<RosterStudentIdentity[]> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.worksheets[0];
    if (!ws) {
      throw new BadRequestException({ message: 'The workbook has no worksheet', code: 'class.import_file_empty' });
    }
    const cellText = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      if (value instanceof Date) {
        const dd = String(value.getDate()).padStart(2, '0');
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${value.getFullYear()}`;
      }
      if (typeof value === 'object') {
        const v = value as { text?: unknown; result?: unknown };
        if (typeof v.text === 'string') return v.text.trim();
        if (v.result !== undefined) return cellText(v.result);
        return '';
      }
      return String(value).trim();
    };
    const rawRows: string[][] = [];
    ws.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellText(cell.value)));
      if (cells.some((c) => c !== '')) rawRows.push(cells);
    });
    if (rawRows.length === 0) return [];
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const header = rawRows[0]!.map(norm);
    const findCol = (...keywords: string[]) => header.findIndex((h) => keywords.some((k) => h.includes(k)));
    const nameCol = findCol('ten', 'name');
    const hasHeader = nameCol >= 0;
    const cols = hasHeader
      ? { name: nameCol, phone: findCol('dien thoai', 'sdt', 'phone'), email: findCol('email', 'mail'), dob: findCol('ngay sinh', 'sinh', 'birth') }
      : { name: 0, phone: 1, email: 2, dob: 3 };
    const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
    if (dataRows.length > 500) {
      throw new BadRequestException({ message: 'Roster import is limited to 500 rows per file', code: 'class.import_too_many_rows' });
    }
    const out: RosterStudentIdentity[] = [];
    for (const cells of dataRows) {
      const fullName = (cells[cols.name] ?? '').trim();
      if (!fullName) continue;
      const email = cols.email >= 0 ? (cells[cols.email] ?? '').trim() : '';
      const phone = cols.phone >= 0 ? (cells[cols.phone] ?? '').trim() : '';
      const dob = cols.dob >= 0 ? (cells[cols.dob] ?? '').trim() : '';
      out.push({
        fullName,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(dob ? { dateOfBirth: dob } : {}),
      });
    }
    return out;
  }

  async buildRosterTemplateWorkbook(): Promise<{ filename: string; buffer: Buffer }> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Danh sách học sinh');
    ws.columns = [{ width: 28 }, { width: 16 }, { width: 28 }, { width: 14 }];
    const header = ws.addRow(['Họ tên', 'Số điện thoại', 'Email', 'Ngày sinh']);
    header.font = { bold: true };
    ws.addRow(['Nguyễn Văn An', '0901234567', 'an.nguyen@example.com', '15/03/2011']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: 'mau-danh-sach-hoc-sinh.xlsx', buffer };
  }


  async listStaff(actorId: string, classId: string): Promise<ClassStaffView> {
    const row = await this.getClassRow(classId);
    if (!(await this.canViewClass(actorId, row))) {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'class.not_found' });
    }
    const ctxId = await this.classContextId(classId);
    const roleIds = new Map<string, ClassStaffRole>();
    for (const shortName of ['classassigner', 'classgrader', 'classrostermanager'] as const) {
      const role = await this.roles.getRoleByShortname(shortName);
      if (role) roleIds.set(role.id, shortName);
    }
    type AssignmentRow = { id: string; userId: string; roleId: string; component: string };
    const assignments = (await this.roles.listAssignments({ contextId: ctxId })) as unknown as AssignmentRow[];
    const rolesByUser = new Map<string, Set<ClassStaffRole>>();
    for (const a of assignments) {
      if (a.component !== '') continue;
      const shortName = roleIds.get(a.roleId);
      if (!shortName) continue;
      const set = rolesByUser.get(a.userId) ?? new Set<ClassStaffRole>();
      set.add(shortName);
      rolesByUser.set(a.userId, set);
    }
    const userIds = [...new Set([row.ownerId, ...rolesByUser.keys()])];
    const usersById = new Map((await this.users.getUsersByIds(userIds)).map((u) => [u.id, u]));
    const toEntry = (userId: string, isOwner: boolean) => {
      const u = usersById.get(userId);
      return {
        userId,
        firstName: u?.firstName ?? '',
        lastName: u?.lastName ?? '',
        username: u?.username ?? '',
        email: u?.email ?? '',
        isOwner,
        roles: [...(rolesByUser.get(userId) ?? [])],
      };
    };
    const staff = [
      toEntry(row.ownerId, true),
      ...[...rolesByUser.keys()].filter((id) => id !== row.ownerId).map((id) => toEntry(id, false)),
    ];
    const canShare = actorId === row.ownerId || (await this.evaluator.hasCapability(actorId, 'class:share', ctxId));
    const canManageRoster = actorId === row.ownerId || (await this.evaluator.hasCapability(actorId, 'class:manageroster', ctxId));
    return { staff, canShare, canManageRoster };
  }

  async setStaffRoles(actorId: string, classId: string, input: { userId?: string; email?: string; roles: ClassStaffRole[] }): Promise<ClassStaffView> {
    const row = await this.getClassRow(classId);
    const ctxId = await this.classContextId(classId);
    await this.evaluator.requireCapability(actorId, 'class:share', ctxId);
    let targetId = input.userId;
    if (!targetId && input.email) {
      const byEmail = await this.users.getByEmail(input.email.trim().toLowerCase());
      if (!byEmail) {
        throw new NotFoundException({ message: `No account with email ${input.email}`, code: 'class.staff_user_not_found' });
      }
      targetId = byEmail.id;
    }
    if (!targetId) {
      throw new BadRequestException({ message: 'A staff member must be identified by userId or email', code: 'class.staff_identity_missing' });
    }
    if (targetId === row.ownerId) {
      throw new BadRequestException({ message: 'The class owner keeps the owner role; transfer ownership instead of editing class roles', code: 'class.owner_roles_locked' });
    }
    await this.ensureClassRoles();
    await this.users.getUser(targetId);
    await this.tenants.ensureActiveMembership(row.tenantId, targetId);
    type AssignmentRow = { id: string; userId: string; roleId: string; component: string };
    const assignments = (await this.roles.listAssignments({ contextId: ctxId, userId: targetId })) as unknown as AssignmentRow[];
    for (const shortName of ['classassigner', 'classgrader', 'classrostermanager'] as const) {
      const role = await this.roles.getRoleByShortname(shortName);
      if (!role) continue;
      const existing = assignments.find((a) => a.roleId === role.id && a.component === '');
      const wanted = input.roles.includes(shortName);
      if (wanted && !existing) await this.roles.assignRole(targetId, role.id, ctxId, actorId);
      if (!wanted && existing) await this.roles.unassignRole(existing.id, actorId);
    }
    return this.listStaff(actorId, classId);
  }


  private async resolveClassByJoinCode(joinCode: string): Promise<ClassRow> {
    const code = joinCode.trim().toUpperCase();
    const row = await tenantAls.run({ ...tenantAls.getStore(), platform: true }, () =>
      this.repo.getClassByJoinCode(code),
    );
    const activeTenantId = this.tenantContext.currentTenantId();
    if (!row || !row.allowSelfReport || !row.joinCode || (activeTenantId && row.tenantId !== activeTenantId)) {
      throw new NotFoundException({ message: 'Join code is not valid for any open class in this space', code: 'class.join_code_invalid' });
    }
    return row;
  }

  private async classByJoinCode(joinCode: string): Promise<ClassRow> {
    return this.resolveClassByJoinCode(joinCode);
  }

  async previewJoin(joinCode: string): Promise<{ classId: string; name: string; schoolYear: string | null; ownerName: string }> {
    const row = await this.resolveClassByJoinCode(joinCode);
    const owner = await this.users.getByIdOrUndefined(row.ownerId);
    return {
      classId: row.id,
      name: row.name,
      schoolYear: row.schoolYear,
      ownerName: owner ? this.displayNameOf(owner) : '',
    };
  }

  async joinByCode(actorId: string, joinCode: string): Promise<JoinClassResult> {
    const row = await this.resolveClassByJoinCode(joinCode);
    if (row.status === 'archived') {
      throw new BadRequestException({ message: 'Class is archived; roster is frozen', code: 'class.archived' });
    }
    const view = { id: row.id, name: row.name, schoolYear: row.schoolYear };
    const body = async (): Promise<JoinClassResult> => {
      if (await this.groups.isCohortMember(row.cohortId, actorId)) {
        return { outcome: 'already_member' as const, class: view };
      }
      const memberCount = (await this.groups.listCohortMembers(row.cohortId)).length;
      if (row.joinAutoApprove || memberCount === 0) {
        await this.tenants.ensureActiveMembership(row.tenantId, actorId);
        await this.groups.addCohortMemberInternal(row.cohortId, actorId);
        await this.outbox.enqueueStandalone({
          aggregate: 'class', type: 'class_member_joined',
          payload: { classId: row.id, tenantId: row.tenantId, userId: actorId, via: 'self_report' },
          tenantId: row.tenantId,
        });
        return { outcome: 'joined' as const, class: view };
      }
      const pending = await this.repo.findPendingJoinRequest(row.id, actorId);
      if (!pending) {
        await this.repo.insertJoinRequest({ tenantId: row.tenantId, classId: row.id, userId: actorId, status: 'pending' });
      }
      return { outcome: 'pending' as const, class: view };
    };
    return tenantAls.run({ ...tenantAls.getStore(), platform: true }, body);
  }

  async listJoinRequests(actorId: string, classId: string): Promise<ClassJoinRequestView[]> {
    await this.getClassRow(classId);
    const ctxId = await this.classContextId(classId);
    await this.evaluator.requireCapability(actorId, 'class:manageroster', ctxId);
    const requests = await this.repo.listJoinRequests(classId, 'pending');
    const usersById = new Map((await this.users.getUsersByIds(requests.map((r) => r.userId))).map((u) => [u.id, u]));
    return requests.map((r) => this.toJoinRequestView(r, usersById.get(r.userId)));
  }

  private toJoinRequestView(r: ClassJoinRequestRow, user?: UserRow): ClassJoinRequestView {
    return {
      id: r.id,
      classId: r.classId,
      userId: r.userId,
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      username: user?.username ?? '',
      email: user?.email ?? '',
      status: r.status as ClassJoinRequestView['status'],
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  }

  async decideJoinRequest(actorId: string, classId: string, requestId: string, approve: boolean): Promise<ClassJoinRequestView> {
    await this.getClassRow(classId);
    const ctxId = await this.classContextId(classId);
    await this.evaluator.requireCapability(actorId, 'class:manageroster', ctxId);
    const request = await this.repo.getJoinRequest(requestId);
    if (!request || request.classId !== classId) {
      throw new NotFoundException({ message: `Join request ${requestId} not found`, code: 'class.join_request_not_found' });
    }
    if (request.status !== 'pending') {
      throw new ConflictException({ message: 'Join request was already decided', code: 'class.join_request_decided' });
    }
    if (approve) await this.addToRoster(actorId, classId, request.userId);
    await this.repo.updateJoinRequest(requestId, {
      status: approve ? 'approved' : 'rejected',
      decidedBy: actorId,
      decidedAt: new Date(),
    });
    const updated = (await this.repo.getJoinRequest(requestId))!;
    const user = await this.users.getByIdOrUndefined(request.userId);
    return this.toJoinRequestView(updated, user);
  }


  async listSuspendedMembers(actorId: string, classId: string): Promise<ClassSuspendedMember[]> {
    const row = await this.getClassRow(classId);
    if (!(await this.canViewClass(actorId, row))) {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'class.not_found' });
    }
    const suspendedIds = await this.repo.listSuspendedMemberIds(row.cohortId);
    if (suspendedIds.length === 0) return [];
    const memberIds = new Set((await this.groups.listCohortMembers(row.cohortId)).map((m) => m.userId));
    const former = suspendedIds.filter((id) => !memberIds.has(id));
    const usersById = new Map((await this.users.getUsersByIds(former)).map((u) => [u.id, u]));
    return former.map((userId) => {
      const u = usersById.get(userId);
      return {
        userId,
        firstName: u?.firstName ?? '',
        lastName: u?.lastName ?? '',
        username: u?.username ?? '',
        email: u?.email ?? '',
      };
    });
  }


  async getClassPublic(actorId: string, id: string): Promise<ClassPublicView> {
    const row = await this.getClassRow(id);
    const owner = await this.users.getByIdOrUndefined(row.ownerId);
    const isMember = await this.groups.isCohortMember(row.cohortId, actorId);
    const feeEnabled = row.feeCost !== null && row.feeCost > 0;
    return {
      classId: row.id,
      name: row.name,
      code: row.code,
      schoolYear: row.schoolYear,
      description: row.description,
      ownerName: owner ? this.displayNameOf(owner) : '',
      status: row.status as ClassPublicView['status'],
      feeCost: row.feeCost,
      feeCurrency: row.feeCurrency,
      feeEnabled,
      isMember,
      canPurchase: feeEnabled && !isMember && row.status === 'active',
    };
  }

  async resolveClassFeePurchase(classId: string, userId: string): Promise<ClassFeeTarget> {
    const row = await this.getClassRow(classId);
    if (row.status === 'archived') {
      throw new BadRequestException({ message: 'Class is archived; enrolment is frozen', code: 'class.archived' });
    }
    if (row.feeCost === null || row.feeCost <= 0) {
      throw new BadRequestException({ message: 'Class has no fee configured', code: 'payment.no_fee' });
    }
    if (await this.groups.isCohortMember(row.cohortId, userId)) {
      throw new ConflictException({ message: 'User is already a member of this class', code: 'class.already_member' });
    }
    return {
      classId: row.id,
      tenantId: row.tenantId,
      feeCost: row.feeCost,
      feeCurrency: row.feeCurrency,
      feePaymentAccountId: row.feePaymentAccountId,
    };
  }

  async getClassFeeTarget(classId: string): Promise<{ tenantId: string; feeCost: number | null } | null> {
    return this.tenantContext.run({ platform: true }, async () => {
      const row = await this.repo.getClass(classId);
      if (!row) return null;
      return { tenantId: row.tenantId, feeCost: row.feeCost };
    });
  }

  async activatePaidClassEnrol(classId: string, userId: string): Promise<void> {
    await this.tenantContext.run({ platform: true }, async () => {
      const row = await this.repo.getClass(classId);
      if (!row) {
        throw new NotFoundException({ message: `Class ${classId} not found`, code: 'class.not_found' });
      }
      if (row.status === 'archived') {
        throw new BadRequestException({ message: 'Class is archived; roster is frozen', code: 'class.archived' });
      }
      if (await this.groups.isCohortMember(row.cohortId, userId)) return;
      await this.tenants.ensureActiveMembership(row.tenantId, userId);
      await this.groups.addCohortMemberInternal(row.cohortId, userId);
      await this.outbox.enqueueStandalone({
        aggregate: 'class', type: 'class_member_joined',
        payload: { classId: row.id, tenantId: row.tenantId, userId, via: 'class_fee' },
        tenantId: row.tenantId,
      });
    });
  }

  async suspendPaidClassMember(classId: string, userId: string, tx?: CentreTx): Promise<string | null> {
    return this.tenantContext.run({ platform: true }, async () => {
      const row = await this.repo.getClass(classId);
      if (!row) return null;
      const removed = await this.groups.removeCohortMemberInternal(row.cohortId, userId, tx);
      return tx && removed ? row.cohortId : null;
    });
  }

  async notifyPaidClassMemberRemoved(cohortId: string, userId: string): Promise<void> {
    await this.groups.emitCohortMemberRemoved(cohortId, userId);
  }


  async resolveClass(classId: string, tenantId: string): Promise<{ classId: string; contextId: string }> {
    const row = await this.repo.getClass(classId);
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'class.not_found' });
    }
    if (row.status === 'archived') {
      throw new BadRequestException({ message: 'Class is archived; cannot add courses', code: 'class.archived' });
    }
    return { classId: row.id, contextId: await this.classContextId(row.id) };
  }

  async onCourseCreated(course: CourseRow): Promise<void> {
    if (!course.classId) return;
    const row = await this.repo.getClass(course.classId);
    if (!row) return;
    const group = await this.groups.createGroupInternal(course.id, CLASS_WHOLE_GROUP_NAME);
    await this.enrol.ensureClassCohortInstance(
      course.id,
      row.cohortId,
      row.onLeave === 'unenrol' ? 'unenrol' : 'suspend',
      group.id,
    );
  }
}
