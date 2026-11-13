import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { extractRichTextPlainText, getTrueFalseStatements, TRUE_FALSE_STATEMENT_COUNT, type RichTextDocument } from '@giaokhoa/contracts';
import type { CentreTx } from '@giaokhoa/db';
import { OutboxService } from '../../infra/events/outbox.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { CAP_ALLOW } from '../access/domain/permission';
import { type ContextRow } from '@giaokhoa/db/repositories/access';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { RolesService } from '../access/roles.service';
import { GroupsService } from '../groups/groups.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import { TenantsService } from '../tenants/tenants.service';
import { truefalseHashAnswers } from './domain/question-engine';
import {
  QuestionsRepository, type EntryRow, type QCategoryRow, type QuestionOutcomeLinkRow, type QuestionRow,
  type QuestionSubjectLinkRow, type QuestionsTx, type VersionRow,
} from '@giaokhoa/db/repositories/questions';
import { QuestionsService, type QuestionView, type SupportedQtype } from './questions.service';
import { QuestionBanksRepository, BANK_KINDS, type BankKind, type ContributionRow, type QuestionBankRow } from '@giaokhoa/db/repositories/question-banks';

export const QBANK_MEMBER_ROLE = 'qbankmember';
export const QBANK_LEAD_ROLE = 'qbanklead';
const MEMBER_CAPS = ['question:useall', 'question:copy', 'files:view'];
const LEAD_CAPS = ['question:useall', 'question:copy', 'question:share', 'question:moderate', 'question:add', 'question:editall', 'question:managecategory', 'files:view', 'files:upload'];
const MATRIX_MEMBER_CAPS = ['matrix:use', 'matrix:copy'];
const MATRIX_LEAD_CAPS = ['matrix:use', 'matrix:add', 'matrix:edit', 'matrix:copy', 'matrix:share', 'matrix:moderate'];
function memberCapsForKind(kind: BankKind): string[] { return kind === 'matrix' ? MATRIX_MEMBER_CAPS : MEMBER_CAPS; }
function leadCapsForKind(kind: BankKind): string[] { return kind === 'matrix' ? MATRIX_LEAD_CAPS : LEAD_CAPS; }
const STAFF_ARCHETYPES = ['manager', 'coursecreator', 'editingteacher', 'teacher'];
export const BANK_SCOPES = ['personal', 'team', 'school', 'course', 'platform'] as const;
export type BankScope = (typeof BANK_SCOPES)[number];

export interface BankCapabilitiesView {
  use: boolean; add: boolean; edit: boolean; manageCategory: boolean; copy: boolean; share: boolean; moderate: boolean;
  matrixView?: boolean; matrixManage?: boolean; matrixCopy?: boolean; matrixShare?: boolean; matrixModerate?: boolean;
}
export interface BankView extends QuestionBankRow {
  capabilities: BankCapabilitiesView;
  defaultCategoryId: string | null;
  categoryIds: string[];
}
export interface AttributionView {
  questionId: string;
  isCopy: boolean;
  derivedFromQuestionId: string | null;
  derivedFromVersionId: string | null;
  derivedFromVersionNumber: number | null;
  originalAuthorId: string | null;
  originalAuthorName: string | null;
  sourceBankId: string | null;
  sourceBankName: string | null;
  copyCount: number;
  useCount: number;
}

@Injectable()
export class QuestionBanksService {
  constructor(
    private readonly repo: QuestionBanksRepository,
    private readonly questionsRepo: QuestionsRepository,
    private readonly questions: QuestionsService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly roles: RolesService,
    private readonly groups: GroupsService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantRepo: TenantsRepository,
    private readonly tenants: TenantsService,
  ) {}

  private async schoolTenantId(): Promise<string> {
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }

  private bankTenantHidden(bank: QuestionBankRow): boolean {
    const active = this.tenantContext.currentTenantId();
    if (active === undefined) return false;
    if (bank.scope === 'personal' || bank.scope === 'platform') return false;
    return bank.tenantId !== active;
  }


  private async ensureBankRoles(): Promise<{ memberRoleId: string; leadRoleId: string }> {
    let member = await this.roles.getRoleByShortname(QBANK_MEMBER_ROLE);
    if (!member) {
      member = await this.roles.createRole({ name: 'Thành viên ngân hàng câu hỏi', shortName: QBANK_MEMBER_ROLE, description: 'Vai thành viên tại context của một bank câu hỏi: dùng + copy câu trong bank.' }).catch(async () => this.roles.getRoleByShortname(QBANK_MEMBER_ROLE));
    }
    let lead = await this.roles.getRoleByShortname(QBANK_LEAD_ROLE);
    if (!lead) {
      lead = await this.roles.createRole({ name: 'Quản trị ngân hàng câu hỏi', shortName: QBANK_LEAD_ROLE, description: 'Vai phụ trách tại context của một bank câu hỏi: toàn quyền trong bank, duyệt đóng góp.' }).catch(async () => this.roles.getRoleByShortname(QBANK_LEAD_ROLE));
    }
    if (!member || !lead) throw new BadRequestException({ message: 'Question bank roles are not available', code: 'question.bank_roles_missing' });
    return { memberRoleId: member.id, leadRoleId: lead.id };
  }

  private async grantCaps(roleId: string, contextId: string, caps: string[], tx?: CentreTx): Promise<void> {
    for (const cap of caps) await this.roles.setCapabilityOverride(roleId, cap, contextId, CAP_ALLOW, undefined, tx);
  }

  private async ensureAssignment(userId: string, roleId: string, contextId: string, tx?: CentreTx): Promise<void> {
    const existing = await this.roles.listAssignments({ userId, contextId }, tx);
    if (!existing.some((a) => (a as { roleId: string }).roleId === roleId)) {
      await this.roles.assignRole(userId, roleId, contextId, undefined, undefined, tx);
    }
  }


  private async buildBank(actorId: string, input: {
    name: string; scope: BankScope; bankKind?: BankKind; ownerId: string | null; scopeRefId: string | null;
    parentContextId: string; contextLevel: number;
    tenantId: string | null;
    leadUserId?: string | null;
  }): Promise<QuestionBankRow> {
    const kind = input.bankKind ?? 'question';
    const { memberRoleId, leadRoleId } = await this.ensureBankRoles();
    const bankId = uuidv7();
    return this.repo.transaction(async (tx) => {
      const ctx = await this.contexts.createContext(input.contextLevel, bankId, input.parentContextId, tx);
      const bank = await this.repo.insertBank({
        id: bankId, tenantId: input.tenantId, name: input.name, scope: input.scope, bankKind: kind, ownerId: input.ownerId,
        scopeRefId: input.scopeRefId, contextId: ctx.id, createdBy: actorId,
      }, tx);
      if (kind === 'question') {
        await this.questionsRepo.insertCategory({
          name: 'Mặc định', contextId: ctx.id, bankId: bank.id, info: '', parent: null,
          stamp: `qbank-${Date.now().toString(36)}-${bank.id.slice(0, 8)}`,
        }, tx);
      }
      await this.grantCaps(memberRoleId, ctx.id, memberCapsForKind(kind), tx);
      await this.grantCaps(leadRoleId, ctx.id, leadCapsForKind(kind), tx);
      const leadUserId = input.ownerId ?? input.leadUserId ?? null;
      if (leadUserId) await this.ensureAssignment(leadUserId, leadRoleId, ctx.id, tx);
      await this.outbox.enqueueKysely(tx, {
        aggregate: 'question_bank', type: 'question_bank_created',
        payload: { bankId: bank.id, scope: bank.scope, scopeRefId: bank.scopeRefId, ownerId: bank.ownerId, actorId },
        tenantId: input.tenantId,
      });
      return bank;
    });
  }

  async ensurePersonalBank(userId: string, kind: BankKind = 'question', opts?: { forCopy?: boolean }): Promise<QuestionBankRow> {
    const existing = await this.repo.getPersonalBank(userId, kind);
    if (existing) return existing;
    const isStaff = (await this.repo.listUserIdsWithArchetypes(STAFF_ARCHETYPES)).includes(userId)
      || (await this.evaluator.isSiteAdmin(userId));
    if (!isStaff && !opts?.forCopy) {
      throw new ForbiddenException({ message: 'Only staff can have a personal question bank', code: 'question.personal_bank_staff_only' });
    }
    const system = await this.contexts.ensureSystemContext();
    try {
      return await this.buildBank(userId, {
        name: 'Ngân hàng của tôi', scope: 'personal', bankKind: kind, ownerId: userId, scopeRefId: null,
        parentContextId: system.id, contextLevel: CONTEXT_LEVELS.USER,
        tenantId: await this.schoolTenantId(),
      });
    } catch (err) {
      const again = await this.repo.getPersonalBank(userId, kind);
      if (again) return again;
      throw err;
    }
  }

  async ensureSchoolBank(actorId: string, kind: BankKind = 'question'): Promise<QuestionBankRow> {
    const tenantId = await this.schoolTenantId();
    const existing = await this.repo.getSchoolBank(tenantId, kind);
    if (existing) return existing;
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    try {
      const bank = await this.buildBank(actorId, {
        name: 'Ngân hàng trường', scope: 'school', bankKind: kind, ownerId: null, scopeRefId: null,
        parentContextId: tenantCtx.id, contextLevel: CONTEXT_LEVELS.COURSECAT,
        tenantId,
      });
      await this.syncSchoolMembers(bank);
      return bank;
    } catch (err) {
      const again = await this.repo.getSchoolBank(tenantId, kind);
      if (again) return again;
      throw err;
    }
  }

  async ensurePlatformBank(actorId: string, kind: BankKind = 'question'): Promise<QuestionBankRow> {
    const existing = await this.repo.getPlatformBank(kind);
    if (existing) return existing;
    const system = await this.contexts.ensureSystemContext();
    try {
      const bank = await this.buildBank(actorId, {
        name: 'Ngân hàng hệ thống', scope: 'platform', bankKind: kind, ownerId: null, scopeRefId: null,
        parentContextId: system.id, contextLevel: CONTEXT_LEVELS.COURSECAT,
        tenantId: null, leadUserId: actorId,
      });
      await this.syncPlatformMembers(bank);
      return bank;
    } catch (err) {
      const again = await this.repo.getPlatformBank(kind);
      if (again) return again;
      throw err;
    }
  }

  async ensureCourseBank(actorId: string, courseId: string, name?: string, kind: BankKind = 'question'): Promise<QuestionBankRow> {
    const existing = await this.repo.getBankByScopeRef('course', courseId, kind);
    if (existing) return existing;
    const courseCtx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, courseId);
    if (!courseCtx) throw new NotFoundException({ message: `No context for course ${courseId}`, code: 'question.course_context_missing' });
    const tenantId = await this.repo.getCourseTenantId(courseId);
    if (!tenantId) throw new NotFoundException({ message: `Course ${courseId} not found`, code: 'question.course_not_found' });
    try {
      return await this.buildBank(actorId, {
        name: name ?? 'Ngân hàng khoá học', scope: 'course', bankKind: kind, ownerId: null, scopeRefId: courseId,
        parentContextId: courseCtx.id, contextLevel: CONTEXT_LEVELS.COURSE,
        tenantId,
      });
    } catch (err) {
      const again = await this.repo.getBankByScopeRef('course', courseId, kind);
      if (again) return again;
      throw err;
    }
  }

  async createBank(actorId: string, input: { name: string; scope: string; bankKind?: string; scopeRefId?: string; leaderId?: string }): Promise<BankView> {
    if (!(BANK_SCOPES as readonly string[]).includes(input.scope)) {
      throw new BadRequestException({ message: `Unknown bank scope ${input.scope}`, code: 'question.bank_scope_invalid' });
    }
    const kind = (input.bankKind ?? 'question') as BankKind;
    if (!(BANK_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException({ message: `Unknown bank kind ${String(input.bankKind)}`, code: 'question.bank_kind_invalid' });
    }
    const scope = input.scope as BankScope;
    if (scope === 'personal') {
      const bank = await this.ensurePersonalBank(actorId, kind);
      return this.bankView(actorId, bank);
    }
    if (scope === 'platform') {
      const system = await this.contexts.ensureSystemContext();
      await this.evaluator.requireCapability(actorId, 'tenant:manage', system.id);
      const bank = await this.ensurePlatformBank(actorId, kind);
      return this.bankView(actorId, bank);
    }
    if (scope === 'school') {
      const tenantId = await this.schoolTenantId();
      const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
      if (!(await this.evaluator.hasCapability(actorId, 'question:managecategory', tenantCtx.id))) {
        const system = await this.contexts.ensureSystemContext();
        await this.evaluator.requireCapability(actorId, 'question:managecategory', system.id);
      }
      const bank = await this.ensureSchoolBank(actorId, kind);
      return this.bankView(actorId, bank);
    }
    if (scope === 'course') {
      if (!input.scopeRefId) throw new BadRequestException({ message: 'scopeRefId (course id) is required for a course bank', code: 'question.bank_scope_ref_required' });
      const courseCtx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, input.scopeRefId);
      if (!courseCtx) throw new NotFoundException({ message: `No context for course ${input.scopeRefId}`, code: 'question.course_context_missing' });
      await this.evaluator.requireCapability(actorId, 'question:managecategory', courseCtx.id);
      const bank = await this.ensureCourseBank(actorId, input.scopeRefId, input.name, kind);
      return this.bankView(actorId, bank);
    }
    if (!input.scopeRefId) throw new BadRequestException({ message: 'scopeRefId (cohort id) is required for a team bank', code: 'question.bank_scope_ref_required' });
    const existing = await this.repo.getBankByScopeRef('team', input.scopeRefId, kind);
    if (existing) return this.bankView(actorId, existing);
    const cohort = await this.groups.getCohort(input.scopeRefId);
    const members = await this.groups.listCohortMembers(cohort.id);
    const isAdmin = await this.evaluator.isSiteAdmin(actorId);
    if (!isAdmin && !members.some((m) => m.userId === actorId)) {
      throw new ForbiddenException({ message: 'Only cohort members can create the team question bank', code: 'question.bank_team_not_member' });
    }
    const leaderId = input.leaderId ?? actorId;
    if (!members.some((m) => m.userId === leaderId)) {
      throw new BadRequestException({ message: 'The team bank leader must be a cohort member', code: 'question.bank_leader_not_member' });
    }
    const parentCtx = await this.contexts.getContext(cohort.contextId).catch(() => undefined)
      ?? (await this.contexts.ensureSystemContext());
    const bank = await this.buildBank(actorId, {
      name: input.name, scope: 'team', bankKind: kind, ownerId: leaderId, scopeRefId: cohort.id,
      parentContextId: parentCtx.id, contextLevel: CONTEXT_LEVELS.COURSECAT,
      tenantId: cohort.tenantId,
    });
    await this.syncTeamMembers(bank);
    return this.bankView(actorId, bank);
  }


  private async syncRoleAssignments(bank: QuestionBankRow, roleId: string, desiredUserIds: Set<string>): Promise<void> {
    const assignments = await this.roles.listAssignments({ contextId: bank.contextId });
    const mine = assignments.filter((a) => (a as { roleId: string }).roleId === roleId) as { id: string; userId: string }[];
    const current = new Set(mine.map((a) => a.userId));
    for (const userId of desiredUserIds) {
      if (!current.has(userId)) await this.roles.assignRole(userId, roleId, bank.contextId);
    }
    for (const a of mine) {
      if (!desiredUserIds.has(a.userId)) await this.roles.unassignRole(a.id);
    }
  }

  async syncTeamMembers(bank: QuestionBankRow): Promise<void> {
    if (bank.scope !== 'team' || !bank.scopeRefId) return;
    const { memberRoleId, leadRoleId } = await this.ensureBankRoles();
    const members = await this.groups.listCohortMembers(bank.scopeRefId).catch(() => []);
    const memberIds = new Set(members.map((m) => m.userId));
    if (bank.ownerId) memberIds.delete(bank.ownerId);
    await this.syncRoleAssignments(bank, memberRoleId, memberIds);
    await this.syncRoleAssignments(bank, leadRoleId, new Set(bank.ownerId ? [bank.ownerId] : []));
  }

  async syncSchoolMembers(bank: QuestionBankRow): Promise<void> {
    if (bank.scope !== 'school' || !bank.tenantId) return;
    const { memberRoleId } = await this.ensureBankRoles();
    const staff = await this.repo.listUserIdsWithArchetypes(STAFF_ARCHETYPES);
    const tenant = await this.tenantRepo.getTenant(bank.tenantId);
    let desired = staff;
    if (tenant && tenant.kind !== 'platform') {
      const members = await this.tenantRepo.listMembershipsForTenant(bank.tenantId);
      const memberIds = new Set(members.filter((m) => m.status === 'active').map((m) => m.userId));
      desired = staff.filter((id) => memberIds.has(id));
    }
    await this.syncRoleAssignments(bank, memberRoleId, new Set(desired));
  }

  async syncPlatformMembers(bank: QuestionBankRow): Promise<void> {
    if (bank.scope !== 'platform') return;
    const { memberRoleId } = await this.ensureBankRoles();
    const staff = await this.repo.listUserIdsWithArchetypes(STAFF_ARCHETYPES);
    await this.syncRoleAssignments(bank, memberRoleId, new Set(staff));
  }

  private async syncMembership(bank: QuestionBankRow): Promise<void> {
    if (bank.scope === 'team') await this.syncTeamMembers(bank);
    else if (bank.scope === 'school') await this.syncSchoolMembers(bank);
    else if (bank.scope === 'platform') await this.syncPlatformMembers(bank);
  }


  async getBankOrThrow(id: string): Promise<QuestionBankRow> {
    const bank = await this.repo.getBank(id);
    if (!bank) throw new NotFoundException({ message: `Question bank ${id} not found`, code: 'question.bank_not_found' });
    return bank;
  }


  async isForeignPersonalBank(actorId: string, bank: QuestionBankRow): Promise<boolean> {
    if (bank.scope !== 'personal' || bank.ownerId === actorId) return false;
    return !(await this.evaluator.isSiteAdmin(actorId));
  }

  private async assertNotForeignPersonalBank(actorId: string, bank: QuestionBankRow): Promise<void> {
    if (await this.isForeignPersonalBank(actorId, bank)) {
      throw new NotFoundException({ message: `Question bank ${bank.id} not found`, code: 'question.bank_not_found' });
    }
  }

  async bankCapabilities(actorId: string, bank: QuestionBankRow): Promise<BankCapabilitiesView> {
    const at = async (cap: string) => this.evaluator.hasCapability(actorId, cap, bank.contextId);
    if (bank.bankKind === 'matrix') {
      const caps = await this.bankLocalMatrixCaps(actorId, bank);
      return {
        use: caps.view, add: caps.add, edit: caps.manage, manageCategory: false,
        copy: caps.copy, share: caps.share, moderate: caps.moderate,
        matrixView: caps.view, matrixManage: caps.manage, matrixCopy: caps.copy, matrixShare: caps.share, matrixModerate: caps.moderate,
      };
    }
    const [use, add, edit, manageCategory, copy, share, moderate] = await Promise.all([
      at('question:useall'), at('question:add'), at('question:editall'), at('question:managecategory'),
      at('question:copy'), at('question:share'), at('question:moderate'),
    ]);
    return { use, add, edit, manageCategory, copy, share, moderate };
  }

  async bankView(actorId: string, bank: QuestionBankRow): Promise<BankView> {
    const categories = await this.repo.listCategoriesOfBank(bank.id);
    return {
      ...bank,
      capabilities: await this.bankCapabilities(actorId, bank),
      defaultCategoryId: categories[0]?.id ?? null,
      categoryIds: categories.map((c) => c.id),
    };
  }

  async assertCanUseBank(actorId: string, bank: QuestionBankRow): Promise<void> {
    await this.assertNotForeignPersonalBank(actorId, bank);
    await this.syncMembership(bank);
    if (!(await this.evaluator.hasCapability(actorId, 'question:useall', bank.contextId))) {
      throw new ForbiddenException({ message: `No access to question bank ${bank.id}`, code: 'question.bank_forbidden' });
    }
  }

  async assertCanUseQuestionInExam(actorId: string, questionId: string): Promise<void> {
    const notFound = () => new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const question = await this.questionsRepo.getQuestion(questionId);
    const category = question ? await this.questionsRepo.getCategory(question.category) : undefined;
    if (!category) throw notFound();

    const bank = category.bankId
      ? await this.repo.getBank(category.bankId)
      : (await this.questionsRepo.getBankByContextId(category.contextId))
        ?? await this.findBankForCategory(category);
    if (category.bankId && !bank) throw notFound();

    if (bank) {
      try {
        await this.assertCanUseBank(actorId, bank);
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ForbiddenException) throw notFound();
        throw error;
      }
    }
    if (!(await this.evaluator.hasCapability(actorId, 'question:useall', category.contextId).catch(() => false))) {
      throw notFound();
    }
  }

  async assertCanUseBankForKind(actorId: string, bank: QuestionBankRow): Promise<void> {
    await this.assertNotForeignPersonalBank(actorId, bank);
    await this.syncMembership(bank);
    if (bank.bankKind === 'matrix') {
      const caps = await this.bankLocalMatrixCaps(actorId, bank);
      if (!caps.view) {
        throw new ForbiddenException({ message: `No access to question bank ${bank.id}`, code: 'question.bank_forbidden' });
      }
      return;
    }
    if (!(await this.evaluator.hasCapability(actorId, 'question:useall', bank.contextId))) {
      throw new ForbiddenException({ message: `No access to question bank ${bank.id}`, code: 'question.bank_forbidden' });
    }
  }

  async findBankById(id: string): Promise<QuestionBankRow | null> {
    return (await this.repo.getBank(id)) ?? null;
  }

  async syncBankMembership(bank: QuestionBankRow): Promise<void> {
    await this.syncMembership(bank);
  }

  async displayNames(userIds: string[]): Promise<Map<string, string | null>> {
    return this.repo.getUserDisplayNames(userIds);
  }

  async bankLocalMatrixCaps(actorId: string, bank: QuestionBankRow): Promise<{
    view: boolean; add: boolean; manage: boolean; copy: boolean; share: boolean; moderate: boolean;
  }> {
    const none = { view: false, add: false, manage: false, copy: false, share: false, moderate: false };
    if (await this.evaluator.isSiteAdmin(actorId)) return { view: true, add: true, manage: true, copy: true, share: true, moderate: true };
    if (bank.scope === 'personal' && bank.ownerId !== actorId) return none;
    const assignments = await this.roles.listAssignments({ userId: actorId, contextId: bank.contextId });
    if (!assignments.length) return none;
    const roleIds = new Set(assignments.map((a) => (a as { roleId: string }).roleId));
    const [memberRole, leadRole] = await Promise.all([
      this.roles.getRoleByShortname(QBANK_MEMBER_ROLE), this.roles.getRoleByShortname(QBANK_LEAD_ROLE),
    ]);
    const isLead = leadRole ? roleIds.has(leadRole.id) : false;
    const isMember = memberRole ? roleIds.has(memberRole.id) : false;
    if (!isLead && !isMember) return none;
    return { view: true, add: isLead, manage: isLead, copy: true, share: isLead, moderate: isLead };
  }

  async listBanks(actorId: string, kind: BankKind = 'question'): Promise<BankView[]> {
    const isStaff = (await this.repo.listUserIdsWithArchetypes(STAFF_ARCHETYPES)).includes(actorId)
      || (await this.evaluator.isSiteAdmin(actorId));
    if (isStaff) await this.ensurePersonalBank(actorId, kind);
    if (isStaff) await this.ensureSchoolBank(actorId, kind);
    const system = await this.contexts.ensureSystemContext();
    if (await this.evaluator.hasCapability(actorId, 'tenant:manage', system.id)) {
      await this.ensurePlatformBank(actorId, kind);
    }
    const all = (await this.repo.listBanks()).filter((b) => b.bankKind === kind);
    const out: BankView[] = [];
    for (const bank of all) {
      if (this.bankTenantHidden(bank)) continue;
      if (bank.scope === 'personal' && bank.ownerId === actorId && !isStaff) continue;
      if (await this.isForeignPersonalBank(actorId, bank)) continue;
      await this.syncMembership(bank);
      const canEnter = kind === 'matrix'
        ? (await this.bankLocalMatrixCaps(actorId, bank)).view
        : await this.evaluator.hasCapability(actorId, 'question:useall', bank.contextId);
      if (canEnter) {
        out.push(await this.bankView(actorId, bank));
      }
    }
    return out;
  }

  async getBank(actorId: string, bankId: string): Promise<BankView> {
    const bank = await this.getBankOrThrow(bankId);
    if (this.bankTenantHidden(bank)) {
      throw new NotFoundException({ message: `Question bank ${bankId} not found`, code: 'question.bank_not_found' });
    }
    await this.assertNotForeignPersonalBank(actorId, bank);
    await this.assertCanUseBankForKind(actorId, bank);
    return this.bankView(actorId, bank);
  }


  async findBankForCategory(category: QCategoryRow): Promise<QuestionBankRow | null> {
    if (category.bankId) return (await this.repo.getBank(category.bankId)) ?? null;
    const ctx = await this.contexts.getContext(category.contextId).catch(() => undefined);
    if (!ctx?.instanceId) return null;
    if (ctx.contextLevel === CONTEXT_LEVELS.COURSE) {
      return (await this.repo.getBankByScopeRef('course', ctx.instanceId)) ?? null;
    }
    if (ctx.contextLevel === CONTEXT_LEVELS.SYSTEM || ctx.contextLevel === CONTEXT_LEVELS.COURSECAT) {
      const pathContexts = await this.contexts.getPathContexts(ctx);
      const tenantCtx = pathContexts.find((c) => c.contextLevel === CONTEXT_LEVELS.TENANT);
      const tenantId = tenantCtx?.instanceId ?? (await this.schoolTenantId());
      return (await this.repo.getSchoolBank(tenantId)) ?? null;
    }
    return null;
  }

  async findBanksForCategories(categories: QCategoryRow[]): Promise<Map<string, QuestionBankRow | null>> {
    const result = new Map<string, QuestionBankRow | null>();
    if (!categories.length) return result;

    const explicitIds = [...new Set(categories.map((c) => c.bankId).filter((id): id is string => id != null))];
    const explicitBanks = explicitIds.length
      ? new Map((await this.repo.getBanksByIds(explicitIds)).map((b) => [b.id, b]))
      : new Map<string, QuestionBankRow>();
    const inferred: QCategoryRow[] = [];
    for (const category of categories) {
      if (category.bankId) result.set(category.id, explicitBanks.get(category.bankId) ?? null);
      else inferred.push(category);
    }
    if (!inferred.length) return result;

    const contextsById = new Map(
      (await this.contexts.getContextsByIds(inferred.map((c) => c.contextId))).map((c) => [c.id, c]),
    );
    const courseRefs = new Map<string, QCategoryRow[]>();
    const schoolCats: { category: QCategoryRow; ctx: ContextRow }[] = [];
    for (const category of inferred) {
      const ctx = contextsById.get(category.contextId);
      if (!ctx?.instanceId) {
        result.set(category.id, null);
      } else if (ctx.contextLevel === CONTEXT_LEVELS.COURSE) {
        const list = courseRefs.get(ctx.instanceId) ?? [];
        list.push(category);
        courseRefs.set(ctx.instanceId, list);
      } else if (ctx.contextLevel === CONTEXT_LEVELS.SYSTEM || ctx.contextLevel === CONTEXT_LEVELS.COURSECAT) {
        schoolCats.push({ category, ctx });
      } else {
        result.set(category.id, null);
      }
    }

    if (courseRefs.size) {
      const courseBanks = await this.repo.listBanksByScopeRefs('course', [...courseRefs.keys()]);
      const firstByRef = new Map<string, QuestionBankRow>();
      for (const bank of courseBanks) {
        if (bank.scopeRefId && !firstByRef.has(bank.scopeRefId)) firstByRef.set(bank.scopeRefId, bank);
      }
      for (const [instanceId, cats] of courseRefs) {
        for (const category of cats) result.set(category.id, firstByRef.get(instanceId) ?? null);
      }
    }

    if (schoolCats.length) {
      const pathIds = [...new Set(schoolCats.flatMap(({ ctx }) => ctx.path.split('/').filter(Boolean)))];
      const pathContextsById = new Map(
        (await this.contexts.getContextsByIds(pathIds)).map((c) => [c.id, c]),
      );
      let fallbackTenantId: string | undefined;
      const tenantIdByCategory = new Map<string, string>();
      for (const { category, ctx } of schoolCats) {
        const rootToLeaf = ctx.path.split('/').filter(Boolean).reverse()
          .map((id) => pathContextsById.get(id)).filter((c) => c !== undefined);
        const tenantCtx = rootToLeaf.find((c) => c.contextLevel === CONTEXT_LEVELS.TENANT);
        if (tenantCtx?.instanceId) {
          tenantIdByCategory.set(category.id, tenantCtx.instanceId);
        } else {
          fallbackTenantId ??= await this.schoolTenantId();
          tenantIdByCategory.set(category.id, fallbackTenantId);
        }
      }
      const schoolBanks = await this.repo.listSchoolBanksByTenantIds([...new Set(tenantIdByCategory.values())]);
      const firstByTenant = new Map<string, QuestionBankRow>();
      for (const bank of schoolBanks) {
        if (bank.tenantId && !firstByTenant.has(bank.tenantId)) firstByTenant.set(bank.tenantId, bank);
      }
      for (const { category } of schoolCats) {
        result.set(category.id, firstByTenant.get(tenantIdByCategory.get(category.id)!) ?? null);
      }
    }
    return result;
  }

  private categoryMatchesBank(
    category: QCategoryRow,
    bank: QuestionBankRow,
    inferredBankByCategory: Map<string, QuestionBankRow | null>,
  ): boolean {
    if (category.bankId) return category.bankId === bank.id;
    if (category.contextId === bank.contextId) return true;
    return inferredBankByCategory.get(category.id)?.id === bank.id;
  }

  async ensureBankForCategory(actorId: string, category: QCategoryRow): Promise<QuestionBankRow | null> {
    const found = await this.findBankForCategory(category);
    if (found) return found;
    const ctx = await this.contexts.getContext(category.contextId).catch(() => undefined);
    if (!ctx?.instanceId) return null;
    if (ctx.contextLevel === CONTEXT_LEVELS.COURSE) {
      return this.ensureCourseBank(actorId, ctx.instanceId).catch(() => null);
    }
    if (ctx.contextLevel === CONTEXT_LEVELS.SYSTEM || ctx.contextLevel === CONTEXT_LEVELS.COURSECAT) {
      return this.ensureSchoolBank(actorId).catch(() => null);
    }
    return null;
  }

  async defaultCategoryOfBank(bank: QuestionBankRow): Promise<QCategoryRow> {
    const categories = await this.repo.listCategoriesOfBank(bank.id);
    const first = categories[0];
    if (!first) throw new BadRequestException({ message: `Question bank ${bank.id} has no category`, code: 'question.bank_no_category' });
    return first;
  }

  async categoryBelongsToBank(category: QCategoryRow, bank: QuestionBankRow): Promise<boolean> {
    if (category.bankId) return category.bankId === bank.id;
    if (category.contextId === bank.contextId) return true;
    const inferred = await this.findBankForCategory(category);
    return inferred?.id === bank.id;
  }


  async getQuestionBankInfo(questionId: string): Promise<QuestionBankInfo | null> {
    const infos = await this.getQuestionBankInfos([questionId]);
    return infos.get(questionId) ?? null;
  }

  async getQuestionBankInfos(questionIds: string[]): Promise<Map<string, QuestionBankInfo | null>> {
    const infos = new Map<string, QuestionBankInfo | null>();
    const uniqueIds = [...new Set(questionIds)];
    if (!uniqueIds.length) return infos;
    const questions = await this.questionsRepo.getQuestionsByIds(uniqueIds);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const entries = await this.questionsRepo.getEntriesByQuestionIds(uniqueIds);
    const entryByQuestion = new Map(entries.map((e) => [e.questionId, e]));
    const categories = await this.questionsRepo.getCategoriesByIds(
      [...new Set(questions.map((q) => q.category))],
    );
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const bankByCategory = await this.findBanksForCategories(categories);
    const versions = await this.questionsRepo.listVersionsForEntries(entries.map((e) => e.id));
    const versionsByEntry = new Map<string, VersionRow[]>();
    for (const v of versions) {
      const list = versionsByEntry.get(v.questionBankEntryId) ?? [];
      list.push(v);
      versionsByEntry.set(v.questionBankEntryId, list);
    }
    for (const questionId of uniqueIds) {
      const q = questionById.get(questionId);
      const entry = entryByQuestion.get(questionId);
      if (!q || !entry) {
        infos.set(questionId, null);
        continue;
      }
      const category = categoryById.get(q.category);
      const bank = category ? (bankByCategory.get(category.id) ?? null) : null;
      infos.set(questionId, this.buildQuestionBankInfo(bank, category, entry, versionsByEntry.get(entry.id) ?? []));
    }
    return infos;
  }

  private buildQuestionBankInfo(
    bank: QuestionBankRow | null,
    category: QCategoryRow | undefined,
    entry: EntryRow,
    versions: VersionRow[],
  ): QuestionBankInfo {
    const ready = versions.filter((v) => v.status === 'ready');
    const latestReady = ready.length ? ready[ready.length - 1]! : null;
    const latest = versions.length ? versions[versions.length - 1]! : null;
    return {
      bank,
      bankExplicit: category?.bankId != null && bank !== null && category.bankId === bank.id,
      entryStatus: entry.status, latestVersion: entry.latestVersion,
      latestVersionId: latest?.id ?? null,
      latestReadyVersionId: latestReady?.id ?? null, latestReadyVersionNumber: latestReady?.version ?? null,
    };
  }

  async getAttribution(questionId: string): Promise<AttributionView> {
    const q = await this.questionsRepo.getQuestion(questionId);
    if (!q) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const names = await this.repo.getUserDisplayNames([q.originalAuthorId ?? '', q.createdBy ?? '']);
    let derivedFromVersionNumber: number | null = null;
    if (q.derivedFromVersionId) {
      const v = await this.questionsRepo.getVersion(q.derivedFromVersionId);
      derivedFromVersionNumber = v?.version ?? null;
    }
    let sourceBankName: string | null = null;
    if (q.derivedFromBankId) {
      sourceBankName = (await this.repo.getBank(q.derivedFromBankId))?.name ?? null;
    }
    const useCounts = await this.repo.countSlotsByQuestionIds([questionId]);
    return {
      questionId,
      isCopy: q.derivedFromQuestionId !== null,
      derivedFromQuestionId: q.derivedFromQuestionId,
      derivedFromVersionId: q.derivedFromVersionId,
      derivedFromVersionNumber,
      originalAuthorId: q.originalAuthorId,
      originalAuthorName: q.originalAuthorId ? (names.get(q.originalAuthorId) ?? null) : null,
      sourceBankId: q.derivedFromBankId,
      sourceBankName,
      copyCount: q.copyCount,
      useCount: useCounts.get(questionId) ?? 0,
    };
  }

  async getAttributionForViewer(actorId: string, questionId: string): Promise<AttributionView> {
    await this.assertQuestionReadableByViewer(actorId, questionId);
    return this.getAttribution(questionId);
  }

  private async assertQuestionReadableByViewer(actorId: string, questionId: string): Promise<void> {
    const q = await this.questionsRepo.getQuestion(questionId);
    if (!q) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const category = await this.questionsRepo.getCategory(q.category);
    if (!category) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const bank = await this.findBankForCategory(category);
    if (bank) await this.syncMembership(bank);
    if (bank && (await this.isForeignPersonalBank(actorId, bank))) {
      throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    }
    const canUse = await this.evaluator.hasCapability(actorId, 'question:useall', category.contextId).catch(() => false);
    if (!canUse) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
  }

  async listContainingExams(actorId: string, questionId: string) {
    await this.assertQuestionReadableByViewer(actorId, questionId);
    return this.repo.listContainingExams(questionId);
  }

  async deepCopyQuestion(actorId: string, source: QuestionView, targetCategory: QCategoryRow): Promise<QuestionView> {
    const sourceQ = source.question;
    const sourceVersion = source.latestVersion;
    const sourceCategory = await this.questionsRepo.getCategory(sourceQ.category);
    const sourceBank = sourceCategory ? await this.findBankForCategory(sourceCategory) : null;
    let created!: { q: QuestionRow; entryId: string; versionId: string };
    await this.questionsRepo.transaction(async (tx) => {
      let stimulusId: string | null = null;
      if (sourceVersion.stimulusId) {
        const stimulus = await this.questionsRepo.getStimulus(sourceVersion.stimulusId);
        if (stimulus) {
          stimulusId = stimulus.categoryId === targetCategory.id
            ? stimulus.id
            : (await this.questionsRepo.insertStimulus({ categoryId: targetCategory.id, createdBy: actorId, content: stimulus.content as never }, tx)).id;
        }
      }
      const q = await this.questionsRepo.insertQuestion({
        category: targetCategory.id, qtype: sourceQ.qtype,
        createdBy: actorId, modifiedBy: actorId,
        derivedFromQuestionId: sourceQ.id,
        derivedFromVersionId: sourceVersion.id,
        derivedFromBankId: sourceBank?.id ?? null,
        originalAuthorId: sourceQ.originalAuthorId ?? sourceQ.createdBy,
        sourceKind: sourceQ.sourceKind ?? null,
        sourceRef: sourceQ.sourceRef ?? null,
        copyCount: 0,
      }, tx);
      const entry = await this.questionsRepo.insertEntry({
        questionCategoryId: targetCategory.id, questionId: q.id, latestVersion: 1, status: 'ready',
      }, tx);
      const version = await this.questionsRepo.insertVersion({
        questionBankEntryId: entry.id, questionId: q.id, version: 1,
        questionText: sourceVersion.questionText as never,
        generalFeedback: sourceVersion.generalFeedback as never,
        defaultMark: sourceVersion.defaultMark, penalty: sourceVersion.penalty,
        stimulusId,
      }, tx);
      await this.questions.cloneVersionContentTx(tx, sourceQ.qtype as SupportedQtype, sourceVersion.id, version.id);
      for (const link of await this.questionsRepo.listQuestionSubjectLinks(sourceQ.id)) {
        await this.questionsRepo.insertQuestionSubjectLink({ questionId: q.id, subjectId: link.subjectId }, tx);
      }
      for (const link of await this.questionsRepo.listQuestionOutcomeLinks(sourceQ.id)) {
        await this.questionsRepo.insertQuestionOutcomeLink({
          questionId: q.id, learningOutcomeId: link.learningOutcomeId, cognitiveLevel: link.cognitiveLevel,
        }, tx);
      }
      created = { q, entryId: entry.id, versionId: version.id };
    });
    await this.questionsRepo.updateQuestion(sourceQ.id, { copyCount: sourceQ.copyCount + 1 });
    await this.outbox.enqueueStandalone({
      aggregate: 'question', type: 'question_copied',
      payload: {
        sourceQuestionId: sourceQ.id, newQuestionId: created.q.id, actorId,
        sourceBankId: sourceBank?.id ?? null, targetCategoryId: targetCategory.id,
        originalAuthorId: sourceQ.originalAuthorId ?? sourceQ.createdBy,
      },
    });
    return this.questions.getQuestion(created.q.id);
  }

  private async assertCanCopySource(actorId: string, source: QuestionView): Promise<void> {
    const sourceQ = source.question;
    const category = await this.questionsRepo.getCategory(sourceQ.category);
    const bank = category ? await this.findBankForCategory(category) : null;
    const capCtx = bank?.contextId ?? category?.contextId;
    if (bank) await this.syncMembership(bank);
    if (bank && (await this.isForeignPersonalBank(actorId, bank))) {
      throw new ForbiddenException({ message: 'Question is not visible to you', code: 'question.copy_source_forbidden' });
    }
    const isAdmin = await this.evaluator.isSiteAdmin(actorId);
    if (!isAdmin && capCtx) {
      const [canUse, canCopy] = await Promise.all([
        this.evaluator.hasCapability(actorId, 'question:useall', capCtx),
        this.evaluator.hasCapability(actorId, 'question:copy', capCtx),
      ]);
      if (!canUse && sourceQ.createdBy !== actorId) {
        throw new ForbiddenException({ message: 'Question is not visible to you', code: 'question.copy_source_forbidden' });
      }
      if (!canCopy) {
        throw new ForbiddenException({ message: 'Missing capability question:copy at the source bank', code: 'question.copy_forbidden' });
      }
    }
    if (source.entry.status === 'hidden' && !isAdmin && sourceQ.createdBy !== actorId) {
      const canModerate = capCtx ? await this.evaluator.hasCapability(actorId, 'question:moderate', capCtx) : false;
      if (!canModerate) {
        throw new ForbiddenException({ message: 'Question has been withdrawn from its bank', code: 'question.withdrawn' });
      }
    }
  }

  async copyQuestion(actorId: string, questionId: string, input: { targetBankId?: string; targetCategoryId?: string }): Promise<QuestionView & { attribution: AttributionView }> {
    const source = await this.questions.getQuestion(questionId);
    await this.assertCanCopySource(actorId, source);
    const targetBank = input.targetBankId
      ? await this.getBankOrThrow(input.targetBankId)
      : await this.ensurePersonalBank(actorId, 'question', { forCopy: true });
    await this.assertNotForeignPersonalBank(actorId, targetBank);
    await this.syncMembership(targetBank);
    let targetCategory: QCategoryRow;
    if (input.targetCategoryId) {
      targetCategory = await this.questions.getCategory(input.targetCategoryId);
      if (!(await this.categoryBelongsToBank(targetCategory, targetBank))) {
        throw new BadRequestException({ message: 'Target category does not belong to the target bank', code: 'question.copy_target_category_mismatch' });
      }
    } else {
      targetCategory = await this.defaultCategoryOfBank(targetBank);
    }
    await this.evaluator.requireCapability(actorId, 'question:add', targetCategory.contextId);
    const view = await this.deepCopyQuestion(actorId, source, targetCategory);
    return { ...view, attribution: await this.getAttribution(view.question.id) };
  }

  async copyQuestionsBatch(actorId: string, input: { questionIds: string[]; targetBankId?: string; targetCategoryId?: string }): Promise<{
    results: { questionId: string; ok: boolean; newQuestionId?: string; error?: string }[];
  }> {
    const results: { questionId: string; ok: boolean; newQuestionId?: string; error?: string }[] = [];
    for (const questionId of input.questionIds) {
      try {
        const view = await this.copyQuestion(actorId, questionId, {
          targetBankId: input.targetBankId, targetCategoryId: input.targetCategoryId,
        });
        results.push({ questionId, ok: true, newQuestionId: view.question.id });
      } catch (err) {
        results.push({ questionId, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { results };
  }


  private async assertCanGovernQuestion(actorId: string, questionId: string): Promise<{ q: QuestionRow; category: QCategoryRow; bank: QuestionBankRow | null }> {
    const q = await this.questionsRepo.getQuestion(questionId);
    if (!q) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const category = await this.questions.getCategory(q.category);
    const bank = await this.findBankForCategory(category);
    if (bank) await this.syncMembership(bank);
    if (q.createdBy === actorId || (await this.evaluator.isSiteAdmin(actorId))) return { q, category, bank };
    if (bank && (await this.isForeignPersonalBank(actorId, bank))) {
      throw new ForbiddenException({ message: 'Only the author or a bank moderator can govern this question', code: 'question.govern_forbidden' });
    }
    const capCtx = bank?.contextId ?? category.contextId;
    const [moderate, editall] = await Promise.all([
      this.evaluator.hasCapability(actorId, 'question:moderate', capCtx),
      this.evaluator.hasCapability(actorId, 'question:editall', capCtx),
    ]);
    if (!moderate && !editall) {
      throw new ForbiddenException({ message: 'Only the author or a bank moderator can govern this question', code: 'question.govern_forbidden' });
    }
    return { q, category, bank };
  }

  async withdrawQuestion(actorId: string, questionId: string, reason: string): Promise<{ questionId: string; status: string; affectedPinIds: string[] }> {
    const { q, bank } = await this.assertCanGovernQuestion(actorId, questionId);
    const entry = await this.questionsRepo.getEntryByQuestion(questionId);
    if (!entry) throw new NotFoundException({ message: `Question ${questionId} has no bank entry`, code: 'question.entry_missing' });
    if (entry.status === 'hidden') {
      throw new ConflictException({ message: 'Question is already withdrawn', code: 'question.already_withdrawn' });
    }
    const affectedPinIds = await this.repo.listPinIdsUsingQuestion(questionId);
    await this.repo.updateEntry(entry.id, {
      status: 'hidden', withdrawnReason: reason, withdrawnBy: actorId, withdrawnAt: new Date(),
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'question', type: 'question_withdrawn',
      payload: { questionId, bankId: bank?.id ?? null, reason, actorId, affectedPinIds, authorId: q.createdBy },
    });
    return { questionId, status: 'hidden', affectedPinIds };
  }

  async restoreQuestion(actorId: string, questionId: string): Promise<{ questionId: string; status: string }> {
    await this.assertCanGovernQuestion(actorId, questionId);
    const entry = await this.questionsRepo.getEntryByQuestion(questionId);
    if (!entry) throw new NotFoundException({ message: `Question ${questionId} has no bank entry`, code: 'question.entry_missing' });
    if (entry.status !== 'hidden') {
      throw new ConflictException({ message: 'Question is not withdrawn', code: 'question.not_withdrawn' });
    }
    await this.repo.updateEntry(entry.id, {
      status: 'ready', withdrawnReason: null, withdrawnBy: null, withdrawnAt: null,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'question', type: 'question_restored',
      payload: { questionId, actorId },
    });
    return { questionId, status: 'ready' };
  }

  async deleteQuestion(actorId: string, questionId: string): Promise<{ deleted: true }> {
    await this.assertCanGovernQuestion(actorId, questionId);
    const [slotPinIds, attempts] = await Promise.all([
      this.repo.listPinIdsUsingQuestion(questionId),
      this.repo.countAttemptsOfQuestion(questionId),
    ]);
    if (slotPinIds.length > 0 || attempts > 0) {
      throw new ConflictException({
        message: 'Question is referenced by exam slots or attempts and cannot be deleted; withdraw it instead',
        code: 'question.delete_blocked_in_use',
      });
    }
    await this.repo.deleteQuestionRow(questionId);
    await this.outbox.enqueueStandalone({
      aggregate: 'question', type: 'question_deleted',
      payload: { questionId, actorId },
    });
    return { deleted: true };
  }


  private normaliseForHash(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private contentHashes(qtype: string, textPlain: string, answers: { textPlain: string; isCorrect: boolean }[]): { hash: string; textHash: string } {
    const textPart = this.normaliseForHash(textPlain.normalize('NFC'));
    const answerPart = answers
      .map((a) => `${this.normaliseForHash(a.textPlain.normalize('NFC'))}:${a.isCorrect ? 1 : 0}`)
      .sort()
      .join('|');
    const hash = createHash('sha256').update(`${qtype}|${textPart}|${answerPart}`).digest('hex');
    const textHash = createHash('sha256').update(`${qtype}|${textPart}`).digest('hex');
    return { hash, textHash };
  }

  private async versionHashes(qtype: string, versionId: string, questionText: unknown): Promise<{ hash: string; textHash: string }> {
    if (qtype === 'truefalse') {
      const key = await this.questionsRepo.getAnswerKey(versionId);
      return this.contentHashes(
        qtype,
        extractRichTextPlainText(questionText as RichTextDocument),
        truefalseHashAnswers(questionText, key?.solution),
      );
    }
    const answers = await this.questionsRepo.listAnswers(versionId);
    return this.contentHashes(
      qtype,
      extractRichTextPlainText(questionText as RichTextDocument),
      answers.map((a) => ({ textPlain: extractRichTextPlainText(a.answer as RichTextDocument), isCorrect: a.isCorrect })),
    );
  }

  private async scanDuplicatesInBank(bank: QuestionBankRow, source: { hash: string; textHash: string }): Promise<{ exactId: string | null; nearId: string | null }> {
    const allCategories = await this.questionsRepo.listCategories();
    const inferredBankByCategory = await this.findBanksForCategories(allCategories);
    const categories = allCategories.filter((cat) => this.categoryMatchesBank(cat, bank, inferredBankByCategory));
    const rows = await this.repo.listQuestionsWithEntryInCategories(categories.map((c) => c.id));
    let nearId: string | null = null;
    for (const { q, entry } of rows) {
      if (entry.status === 'hidden') continue;
      const version = await this.questionsRepo.getVersionByNumber(entry.id, entry.latestVersion);
      if (!version) continue;
      const candidate = await this.versionHashes(q.qtype, version.id, version.questionText);
      if (candidate.hash === source.hash) return { exactId: q.id, nearId };
      if (candidate.textHash === source.textHash && nearId === null) nearId = q.id;
    }
    return { exactId: null, nearId };
  }

  private async findDuplicatesInBank(bank: QuestionBankRow, qtype: string, sourceVersionId: string, sourceText: unknown): Promise<{ exactId: string | null; nearId: string | null }> {
    const source = await this.versionHashes(qtype, sourceVersionId, sourceText);
    return this.scanDuplicatesInBank(bank, source);
  }

  async findDuplicatesForPayload(bank: QuestionBankRow, payload: {
    qtype: string; questionText: string; answers: { text: string; correct: boolean }[];
  }): Promise<{ exactId: string | null; nearId: string | null }> {
    const source = this.contentHashes(payload.qtype, payload.questionText, payload.answers.map((a) => ({ textPlain: a.text, isCorrect: a.correct })));
    return this.scanDuplicatesInBank(bank, source);
  }

  async setQuestionStatus(questionId: string, status: 'draft' | 'ready'): Promise<void> {
    const entry = await this.questionsRepo.getEntryByQuestion(questionId);
    if (!entry) {
      throw new NotFoundException({ message: `Question ${questionId} has no bank entry`, code: 'question.entry_missing' });
    }
    if (status === 'ready') await this.assertReadyContent(questionId, entry.latestVersion);
    await this.questionsRepo.updateEntry(entry.id, { status });
    const version = await this.questionsRepo.getVersionByNumber(entry.id, entry.latestVersion);
    if (version) await this.questionsRepo.updateVersion(version.id, { status });
  }

  private async assertReadyContent(questionId: string, latestVersion: number): Promise<void> {
    const q = await this.questionsRepo.getQuestion(questionId);
    if (!q) {
      throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    }
    const entry = await this.questionsRepo.getEntryByQuestion(questionId);
    const version = entry ? await this.questionsRepo.getVersionByNumber(entry.id, latestVersion) : undefined;
    if (!version) {
      throw new NotFoundException({ message: `Question ${questionId} latest version missing`, code: 'question.version_missing' });
    }
    const answers = await this.questionsRepo.listAnswers(version.id);
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const bad = (message: string): BadRequestException => new BadRequestException({ message, code: 'question.bad_answer_data' });
    if (q.qtype === 'multichoice') {
      if (answers.length !== 4) throw bad('A ready multichoice question needs exactly four choices');
      if (correctCount !== 1) throw bad('A ready multichoice question needs exactly one correct answer');
    } else if (q.qtype === 'truefalse') {
      const statements = getTrueFalseStatements(version.questionText as RichTextDocument);
      if (!statements || statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
        throw bad('A ready truefalse question needs a stem ending with exactly four statements');
      }
      const key = await this.questionsRepo.getAnswerKey(version.id);
      const solution = key?.solution as { answers?: { statementId: string; value: boolean }[] } | null | undefined;
      const covered = new Set((solution?.answers ?? []).map((a) => a.statementId));
      if (covered.size !== statements.length || statements.some((s) => !covered.has(s.id))) {
        throw bad('A ready truefalse question needs a Đúng/Sai answer for every statement');
      }
    } else if (q.qtype === 'shortanswer') {
      if (answers.length === 0) throw bad('A ready shortanswer question needs at least one accepted answer');
      if (correctCount !== answers.length) throw bad('Every listed shortanswer answer must be an accepted answer');
    }
  }

  async setQuestionStatusForActor(actorId: string, questionId: string, status: 'draft' | 'ready'): Promise<{ questionId: string; status: string }> {
    await this.assertCanGovernQuestion(actorId, questionId);
    const entry = await this.questionsRepo.getEntryByQuestion(questionId);
    if (!entry) {
      throw new NotFoundException({ message: `Question ${questionId} has no bank entry`, code: 'question.entry_missing' });
    }
    if (entry.status === 'hidden') {
      throw new ConflictException({ message: 'Question is withdrawn; restore it before changing its publish status', code: 'question.status_withdrawn' });
    }
    if (entry.status !== status) {
      await this.setQuestionStatus(questionId, status);
      await this.outbox.enqueueStandalone({
        aggregate: 'question', type: status === 'ready' ? 'question_published' : 'question_unpublished',
        payload: { questionId, actorId },
      });
    }
    return { questionId, status };
  }

  async proposeContribution(actorId: string, targetBankId: string, input: {
    questionId: string; note?: string; mode?: string; targetQuestionId?: string;
  }): Promise<ContributionRow> {
    const bank = await this.getBankOrThrow(targetBankId);
    if (bank.scope === 'personal') {
      throw new BadRequestException({ message: 'Cannot contribute to a personal bank', code: 'question.contribution_target_personal' });
    }
    await this.syncMembership(bank);
    const source = await this.questions.getQuestion(input.questionId);
    const sourceCategory = await this.questionsRepo.getCategory(source.question.category);
    const sourceBank = sourceCategory ? await this.findBankForCategory(sourceCategory) : null;
    if (sourceBank && (await this.isForeignPersonalBank(actorId, sourceBank))) {
      throw new NotFoundException({ message: `Question ${input.questionId} not found`, code: 'question.not_found' });
    }
    const shareCtx = sourceBank?.contextId ?? sourceCategory?.contextId;
    if (shareCtx) {
      if (sourceBank) await this.syncMembership(sourceBank);
      await this.evaluator.requireCapability(actorId, 'question:share', shareCtx);
    }
    if (source.entry.status !== 'ready') {
      throw new BadRequestException({ message: 'Only a ready question can be contributed', code: 'question.contribution_source_not_ready' });
    }
    const mode = input.mode ?? 'new';
    if (mode !== 'new' && mode !== 'update') {
      throw new BadRequestException({ message: `Unknown contribution mode ${mode}`, code: 'question.contribution_mode_invalid' });
    }
    let nearDuplicateOf: string | null = null;
    if (mode === 'update') {
      if (!input.targetQuestionId) {
        throw new BadRequestException({ message: 'targetQuestionId is required for an update contribution', code: 'question.contribution_target_required' });
      }
      const target = await this.questions.getQuestion(input.targetQuestionId);
      const targetCategory = await this.questionsRepo.getCategory(target.question.category);
      if (!targetCategory || !(await this.categoryBelongsToBank(targetCategory, bank))) {
        throw new BadRequestException({ message: 'Target question does not belong to the target bank', code: 'question.contribution_target_not_in_bank' });
      }
      if (source.question.derivedFromQuestionId !== input.targetQuestionId) {
        throw new BadRequestException({ message: 'An update contribution must come from a copy derived from the target question', code: 'question.contribution_not_derived' });
      }
    } else {
      const dup = await this.findDuplicatesInBank(bank, source.question.qtype, source.latestVersion.id, source.latestVersion.questionText);
      if (dup.exactId) {
        throw new ConflictException({
          message: `An identical question already exists in the target bank: ${dup.exactId}`,
          code: 'question.duplicate_in_bank',
        });
      }
      nearDuplicateOf = dup.nearId;
    }
    const pending = await this.repo.listContributions({ targetBankId: bank.id, status: 'pending', proposerId: actorId });
    if (pending.some((c) => c.questionId === input.questionId && c.mode === mode && c.targetQuestionId === (input.targetQuestionId ?? null))) {
      throw new ConflictException({ message: 'An identical pending contribution already exists', code: 'question.contribution_pending_exists' });
    }
    const { hash } = await this.versionHashes(source.question.qtype, source.latestVersion.id, source.latestVersion.questionText);
    const row = await this.repo.insertContribution({
      questionId: input.questionId, targetBankId: bank.id,
      targetQuestionId: input.targetQuestionId ?? null,
      proposerId: actorId, note: input.note ?? '', mode,
      status: 'pending', contentHash: hash, nearDuplicateOf,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'question_bank', type: 'question_contribution_proposed',
      payload: { contributionId: row.id, targetBankId: bank.id, questionId: input.questionId, mode, proposerId: actorId, nearDuplicateOf },
    });
    return row;
  }

  async listContributions(actorId: string, bankId: string, status?: string): Promise<(ContributionRow & { proposerName: string | null; questionName: string | null })[]> {
    const bank = await this.getBankOrThrow(bankId);
    await this.assertNotForeignPersonalBank(actorId, bank);
    await this.syncMembership(bank);
    const canModerate = await this.evaluator.hasCapability(actorId, 'question:moderate', bank.contextId);
    const rows = await this.repo.listContributions({
      targetBankId: bank.id, status,
      proposerId: canModerate ? undefined : actorId,
    });
    const names = await this.repo.getUserDisplayNames(rows.map((r) => r.proposerId));
    const out: (ContributionRow & { proposerName: string | null; questionName: string | null })[] = [];
    for (const row of rows) {
      const q = await this.questionsRepo.getQuestion(row.questionId);
      let questionName: string | null = null;
      if (q) {
        const entry = await this.questionsRepo.getEntryByQuestion(q.id);
        const version = entry ? await this.questionsRepo.getVersionByNumber(entry.id, entry.latestVersion) : undefined;
        if (version) {
          const text = extractRichTextPlainText(version.questionText as RichTextDocument).trim();
          questionName = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        }
      }
      out.push({ ...row, proposerName: names.get(row.proposerId) ?? null, questionName });
    }
    return out;
  }

  private async copyStimulusForCategory(tx: QuestionsTx, sourceStimulusId: string | null, targetCategoryId: string, actorId: string): Promise<string | null> {
    if (!sourceStimulusId) return null;
    const stimulus = await this.questionsRepo.getStimulus(sourceStimulusId);
    if (!stimulus) return null;
    if (stimulus.categoryId === targetCategoryId) return stimulus.id;
    const copy = await this.questionsRepo.insertStimulus(
      { categoryId: targetCategoryId, createdBy: actorId, content: stimulus.content as never }, tx);
    return copy.id;
  }

  async approveContribution(actorId: string, bankId: string, contributionId: string, input: { targetCategoryId?: string }): Promise<ContributionRow> {
    const bank = await this.getBankOrThrow(bankId);
    await this.syncMembership(bank);
    await this.evaluator.requireCapability(actorId, 'question:moderate', bank.contextId);
    const contribution = await this.repo.getContribution(contributionId);
    if (!contribution || contribution.targetBankId !== bank.id) {
      throw new NotFoundException({ message: `Contribution ${contributionId} not found`, code: 'question.contribution_not_found' });
    }
    if (contribution.status !== 'pending') {
      throw new ConflictException({ message: 'Contribution is no longer pending', code: 'question.contribution_not_pending' });
    }
    const source = await this.questions.getQuestion(contribution.questionId);
    let resultQuestionId: string;
    if (contribution.mode === 'update') {
      const targetView = await this.questions.getQuestion(contribution.targetQuestionId!);
      const targetCategory = await this.questions.getCategory(targetView.question.category);
      const nextVersion = targetView.entry.latestVersion + 1;
      await this.questionsRepo.transaction(async (tx) => {
        const stimulusId = await this.copyStimulusForCategory(tx, source.latestVersion.stimulusId, targetCategory.id, actorId);
        const version = await this.questionsRepo.insertVersion({
          questionBankEntryId: targetView.entry.id, questionId: targetView.question.id, version: nextVersion,
          questionText: source.latestVersion.questionText as never,
          generalFeedback: source.latestVersion.generalFeedback as never,
          defaultMark: source.latestVersion.defaultMark, penalty: source.latestVersion.penalty,
          stimulusId,
        }, tx);
        await this.questions.cloneVersionContentTx(tx, targetView.question.qtype as SupportedQtype, source.latestVersion.id, version.id);
      });
      await this.questionsRepo.updateEntry(targetView.entry.id, { latestVersion: nextVersion });
      await this.questionsRepo.updateQuestion(targetView.question.id, { modifiedBy: actorId });
      resultQuestionId = targetView.question.id;
    } else {
      const dup = await this.findDuplicatesInBank(bank, source.question.qtype, source.latestVersion.id, source.latestVersion.questionText);
      if (dup.exactId && dup.exactId !== contribution.questionId) {
        throw new ConflictException({
          message: `An identical question already exists in the target bank: ${dup.exactId}`,
          code: 'question.duplicate_in_bank',
        });
      }
      let targetCategory: QCategoryRow;
      if (input.targetCategoryId) {
        targetCategory = await this.questions.getCategory(input.targetCategoryId);
        if (!(await this.categoryBelongsToBank(targetCategory, bank))) {
          throw new BadRequestException({ message: 'Target category does not belong to the target bank', code: 'question.copy_target_category_mismatch' });
        }
      } else {
        targetCategory = await this.defaultCategoryOfBank(bank);
      }
      const view = await this.deepCopyQuestion(actorId, source, targetCategory);
      resultQuestionId = view.question.id;
    }
    await this.repo.updateContribution(contribution.id, {
      status: 'approved', reviewerId: actorId, resultQuestionId,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'question_bank', type: 'question_contribution_approved',
      payload: {
        contributionId: contribution.id, targetBankId: bank.id, questionId: contribution.questionId,
        mode: contribution.mode, resultQuestionId, reviewerId: actorId, proposerId: contribution.proposerId,
      },
    });
    return (await this.repo.getContribution(contribution.id))!;
  }

  async rejectContribution(actorId: string, bankId: string, contributionId: string, reason: string): Promise<ContributionRow> {
    const bank = await this.getBankOrThrow(bankId);
    await this.syncMembership(bank);
    await this.evaluator.requireCapability(actorId, 'question:moderate', bank.contextId);
    const contribution = await this.repo.getContribution(contributionId);
    if (!contribution || contribution.targetBankId !== bank.id) {
      throw new NotFoundException({ message: `Contribution ${contributionId} not found`, code: 'question.contribution_not_found' });
    }
    if (contribution.status !== 'pending') {
      throw new ConflictException({ message: 'Contribution is no longer pending', code: 'question.contribution_not_pending' });
    }
    await this.repo.updateContribution(contribution.id, {
      status: 'rejected', reviewerId: actorId, rejectReason: reason,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'question_bank', type: 'question_contribution_rejected',
      payload: {
        contributionId: contribution.id, targetBankId: bank.id, questionId: contribution.questionId,
        reviewerId: actorId, proposerId: contribution.proposerId, reason,
      },
    });
    return (await this.repo.getContribution(contribution.id))!;
  }


  async discover(actorId: string, filter: {
    bankId?: string; subjectId?: string; nodeId?: string; outcomeId?: string;
    cognitiveLevel?: string; qtype?: string; keyword?: string; authorId?: string;
  }): Promise<DiscoveryItem[]> {
    const banks = await this.listBanks(actorId);
    const bankById = new Map(banks.map((b) => [b.id, b]));
    if (filter.bankId && !bankById.has(filter.bankId)) {
      throw new ForbiddenException({ message: `No access to question bank ${filter.bankId}`, code: 'question.bank_forbidden' });
    }
    const activeBanks = filter.bankId ? [bankById.get(filter.bankId)!] : banks;
    const moderatorByBank = new Map<string, boolean>();
    for (const b of activeBanks) moderatorByBank.set(b.id, b.capabilities.moderate);

    const allCategories = await this.questionsRepo.listCategories();
    const inferredBankByCategory = await this.findBanksForCategories(allCategories);
    const categoryBank = new Map<string, QuestionBankRow>();
    for (const cat of allCategories) {
      const matchIds = new Set<string>();
      if (cat.bankId) {
        matchIds.add(cat.bankId);
      } else {
        for (const bank of activeBanks) {
          if (bank.contextId === cat.contextId) matchIds.add(bank.id);
        }
        const inferred = inferredBankByCategory.get(cat.id);
        if (inferred) matchIds.add(inferred.id);
      }
      const winner = activeBanks.find((b) => matchIds.has(b.id));
      if (winner) categoryBank.set(cat.id, winner);
    }
    let rows = await this.repo.listQuestionsWithEntryInCategories([...categoryBank.keys()]);

    if (filter.subjectId !== undefined || filter.outcomeId !== undefined || filter.cognitiveLevel !== undefined) {
      const linked = await this.questionsRepo.filterQuestionsByCurriculumLinks({
        subjectId: filter.subjectId, outcomeId: filter.outcomeId, cognitiveLevel: filter.cognitiveLevel,
      });
      const ids = new Set(linked.map((q) => q.id));
      rows = rows.filter((r) => ids.has(r.q.id));
    }
    const outcomeLinksByQuestion = new Map<string, QuestionOutcomeLinkRow[]>();
    if (rows.length) {
      const allOutcomeLinks = await this.questionsRepo.listQuestionOutcomeLinksForQuestions(rows.map((r) => r.q.id));
      for (const link of allOutcomeLinks) {
        const list = outcomeLinksByQuestion.get(link.questionId) ?? [];
        list.push(link);
        outcomeLinksByQuestion.set(link.questionId, list);
      }
    }
    if (filter.nodeId !== undefined) {
      const outcomeIds = new Set(await this.repo.listOutcomeIdsForNode(filter.nodeId));
      rows = rows.filter((r) => (outcomeLinksByQuestion.get(r.q.id) ?? [])
        .some((l) => outcomeIds.has(l.learningOutcomeId)));
    }
    if (filter.qtype !== undefined) rows = rows.filter((r) => r.q.qtype === filter.qtype);
    if (filter.authorId !== undefined) {
      rows = rows.filter((r) => r.q.createdBy === filter.authorId || r.q.originalAuthorId === filter.authorId);
    }

    const useCounts = await this.repo.countSlotsByQuestionIds(rows.map((r) => r.q.id));
    const names = await this.repo.getUserDisplayNames(
      rows.flatMap((r) => [r.q.createdBy ?? '', r.q.originalAuthorId ?? '']),
    );
    const versionByEntry = new Map<string, VersionRow>();
    const subjectLinksByQuestion = new Map<string, QuestionSubjectLinkRow[]>();
    if (rows.length) {
      const allVersions = await this.questionsRepo.listVersionsForEntries(rows.map((r) => r.entry.id));
      const wantedVersionByEntry = new Map(rows.map((r) => [r.entry.id, r.entry.latestVersion]));
      for (const v of allVersions) {
        if (wantedVersionByEntry.get(v.questionBankEntryId) === v.version) versionByEntry.set(v.questionBankEntryId, v);
      }
      const allSubjectLinks = await this.questionsRepo.listQuestionSubjectLinksForQuestions(rows.map((r) => r.q.id));
      for (const link of allSubjectLinks) {
        const list = subjectLinksByQuestion.get(link.questionId) ?? [];
        list.push(link);
        subjectLinksByQuestion.set(link.questionId, list);
      }
    }
    const keyword = filter.keyword?.toLowerCase();
    const out: DiscoveryItem[] = [];
    for (const { q, entry } of rows) {
      const bank = categoryBank.get(q.category)!;
      const privileged = q.createdBy === actorId || (moderatorByBank.get(bank.id) ?? false);
      if (entry.status !== 'ready' && !privileged) continue;
      const version = versionByEntry.get(entry.id);
      const textPlain = version ? extractRichTextPlainText(version.questionText as RichTextDocument).trim() : '';
      if (keyword && !textPlain.toLowerCase().includes(keyword)) continue;
      const subjectLinks = subjectLinksByQuestion.get(q.id) ?? [];
      const outcomeLinks = outcomeLinksByQuestion.get(q.id) ?? [];
      out.push({
        questionId: q.id, excerpt: textPlain.length > 120 ? `${textPlain.slice(0, 120)}…` : textPlain, qtype: q.qtype, status: entry.status,
        latestVersion: entry.latestVersion,
        idnumber: q.idnumber,
        bankId: bank.id, bankName: bank.name, bankScope: bank.scope,
        authorId: q.createdBy, authorName: q.createdBy ? (names.get(q.createdBy) ?? null) : null,
        originalAuthorId: q.originalAuthorId,
        originalAuthorName: q.originalAuthorId ? (names.get(q.originalAuthorId) ?? null) : null,
        derivedFromQuestionId: q.derivedFromQuestionId,
        useCount: useCounts.get(q.id) ?? 0,
        copyCount: q.copyCount,
        subjectIds: subjectLinks.map((l) => l.subjectId),
        outcomes: outcomeLinks.map((l) => ({ outcomeId: l.learningOutcomeId, cognitiveLevel: l.cognitiveLevel })),
      });
    }
    out.sort((a, b) => b.useCount - a.useCount || b.copyCount - a.copyCount);
    return out;
  }
}

export interface QuestionBankInfo {
  bank: QuestionBankRow | null;
  bankExplicit: boolean;
  entryStatus: string;
  latestVersion: number;
  latestVersionId: string | null;
  latestReadyVersionId: string | null;
  latestReadyVersionNumber: number | null;
}

export interface DiscoveryItem {
  questionId: string;
  excerpt: string;
  qtype: string;
  status: string;
  latestVersion: number;
  idnumber: string | null;
  bankId: string;
  bankName: string;
  bankScope: string;
  authorId: string | null;
  authorName: string | null;
  originalAuthorId: string | null;
  originalAuthorName: string | null;
  derivedFromQuestionId: string | null;
  useCount: number;
  copyCount: number;
  subjectIds: string[];
  outcomes: { outcomeId: string; cognitiveLevel: string }[];
}
