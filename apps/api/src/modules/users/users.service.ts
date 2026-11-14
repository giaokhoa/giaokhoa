import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../../common/http-errors';
import type { MyAccessView } from '@giaokhoa/contracts';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';
import { UsersRepository, type UserListFilter, type UserPatch, type UserRow } from '@giaokhoa/db/repositories/users';
import { OutboxService } from '../../infra/events/outbox.service';
import type { ContextRow } from '@giaokhoa/db/repositories/access';
import { ContextsService } from '../access/contexts.service';
import { CredentialBridgeService } from '../auth/better-auth/credential-bridge.service';
import { SessionService } from '../auth/session.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { PlanLimitsService } from '../access/plan-limits.service';
import { RolesService } from '../access/roles.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { PasswordService } from './password.service';

export const USER_COMPONENT = 'core_user';
export const USER_AREA = 'user';

export interface UserProfileView {
  id: string; username: string; firstName: string; lastName: string;
  email?: string;
  suspended: boolean; deleted: boolean; isGuest: boolean; forcePasswordChange: boolean;
  lastLogin: Date | null; createdAt: Date;
  customFields: { shortName: string; name: string; type: string; value: string | null }[];
}

export function normalizeIdentity(value: string): string { return value.trim().toLowerCase(); }

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repo: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly roles: RolesService,
    private readonly customFields: CustomFieldsService,
    private readonly outbox: OutboxService,
    private readonly planLimits: PlanLimitsService,
    @Inject(forwardRef(() => CredentialBridgeService))
    private readonly credentialBridge: CredentialBridgeService,
    @Inject(forwardRef(() => AuthRepository))
    private readonly authRepository: AuthRepository,
    @Inject(forwardRef(() => SessionService))
    private readonly sessions: SessionService,
  ) {}

  private async syncCredential(userId: string): Promise<void> {
    try {
      await this.credentialBridge.syncCredentialPassword(userId);
    } catch (err) {
      this.logger.warn(`credential sync failed for user ${userId}: ${String(err)}`);
    }
  }

  async getMyAccess(userId: string, opts?: { isGuest?: boolean }): Promise<MyAccessView> {
    const isSiteAdmin = await this.evaluator.isSiteAdmin(userId);
    const assignmentRows = (await this.roles.listAssignments({ userId: userId })) as {
      id: string; roleId: string; contextId: string;
    }[];
    const roleById = new Map((await this.roles.listRoles()).map((r) => [r.id, r]));

    const contextById = new Map<string, ContextRow>();
    const assignmentContextIds = [...new Set(assignmentRows.map((r) => r.contextId))];
    for (const row of await this.contexts.getContextsByIds(assignmentContextIds)) {
      contextById.set(row.id, row);
    }
    const ancestorIds = new Set<string>();
    for (const id of assignmentContextIds) {
      const ctx = contextById.get(id);
      if (!ctx) notFound(`Context ${id} not found`, 'access.context_not_found');
      for (const pathId of ctx.path.split('/').filter(Boolean)) {
        if (!contextById.has(pathId)) ancestorIds.add(pathId);
      }
    }
    for (const row of await this.contexts.getContextsByIds([...ancestorIds])) {
      contextById.set(row.id, row);
    }

    const assignments: MyAccessView['assignments'] = [];
    const relatedContexts = new Map<string, ContextRow>();
    const system = await this.contexts.ensureSystemContext();
    relatedContexts.set(system.id, system);
    if (!contextById.has(system.id)) contextById.set(system.id, system);
    for (const row of assignmentRows) {
      const ctx = contextById.get(row.contextId)!;
      const role = roleById.get(row.roleId);
      assignments.push({
        id: row.id,
        roleId: row.roleId,
        roleShortname: role?.shortName ?? '',
        roleName: role?.name ?? '',
        contextId: ctx.id,
        contextLevel: ctx.contextLevel,
        contextPath: ctx.path,
        instanceId: ctx.instanceId,
      });
      for (const pathId of ctx.path.split('/').filter(Boolean).reverse()) {
        const pathCtx = contextById.get(pathId);
        if (pathCtx) relatedContexts.set(pathCtx.id, pathCtx);
      }
    }

    const related = [...relatedContexts.values()];
    const resolvedByContext = await this.evaluator.resolveCapabilitiesForContexts(userId, related, contextById, opts);
    const contexts: MyAccessView['contexts'] = related.map((ctx) => ({
      contextId: ctx.id,
      contextLevel: ctx.contextLevel,
      contextPath: ctx.path,
      capabilities: resolvedByContext.get(ctx.id) ?? [],
    }));
    const liveBadge = await this.repo.dbHandle
      .selectFrom('badge_issued')
      .select(['id'])
      .where('user_id', '=', userId)
      .where('revoked', '=', false)
      .limit(1)
      .executeTakeFirst();
    const ownPlan = await this.repo.dbHandle
      .selectFrom('learning_plans')
      .select(['id'])
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    const hasLearnerArtifacts = !!liveBadge || !!ownPlan;
    return { userId, isSiteAdmin, assignments, contexts, hasLearnerArtifacts };
  }

  async createUser(input: { username: string; email: string; password: string; firstName?: string; lastName?: string; forcePasswordChange?: boolean; customFields?: Record<string, string> }): Promise<UserRow> {
    const username = normalizeIdentity(input.username);
    const email = normalizeIdentity(input.email);
    if (await this.repo.getByUsername(username)) conflict(`Username ${username} is taken`, 'user.username_taken');
    if (await this.repo.getByEmail(email)) conflict(`Email ${email} is taken`, 'user.email_taken');
    if (input.customFields) await this.customFields.validateValuesForInstance(USER_COMPONENT, USER_AREA, input.customFields);
    const policyErrors = this.passwords.validatePolicy(input.password);
    if (policyErrors.length) badRequest(policyErrors.join('; '), 'user.password_policy');
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.repo.transaction(async (tx) => {
      const created = await this.repo.insertUser({
        username, email, passwordHash,
        firstName: input.firstName ?? '', lastName: input.lastName ?? '',
        forcePasswordChange: input.forcePasswordChange ?? false,
      }, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'user', type: 'user_created', payload: { userId: created.id, username } });
      return created;
    });
    await this.contexts.createContext(CONTEXT_LEVELS.USER, user.id, (await this.contexts.ensureSystemContext()).id);
    if (input.customFields) await this.customFields.setValuesForInstance(USER_COMPONENT, USER_AREA, user.id, input.customFields);
    await this.syncCredential(user.id);
    return user;
  }

  async ensureGuestUser(): Promise<UserRow> {
    const existing = await this.repo.getByUsername('guest');
    if (existing) return existing;
    const guest = await this.repo.insertUser({ username: 'guest', email: 'guest@localhost', passwordHash: null, firstName: 'Guest', lastName: 'User', isGuest: true });
    await this.contexts.createContext(CONTEXT_LEVELS.USER, guest.id, (await this.contexts.ensureSystemContext()).id);
    return guest;
  }

  async getUser(id: string): Promise<UserRow> {
    const row = await this.repo.getById(id);
    if (!row) notFound(`User ${id} not found`, 'user.not_found');
    return row;
  }
  async createExternalUser(input: { email: string; firstName?: string; lastName?: string }): Promise<UserRow> {
    const email = normalizeIdentity(input.email);
    if (await this.repo.getByEmail(email)) conflict(`Email ${email} is taken`, 'user.email_taken');
    const base = email.split('@')[0]!.replace(/[^a-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user';
    let username = base;
    for (let suffix = 2; await this.repo.getByUsername(username); suffix += 1) username = `${base}${suffix}`;
    const user = await this.repo.transaction(async (tx) => {
      const created = await this.repo.insertUser({
        username, email, passwordHash: null,
        firstName: input.firstName ?? '', lastName: input.lastName ?? '',
        forcePasswordChange: false,
      }, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'user', type: 'user_created', payload: { userId: created.id, username } });
      return created;
    });
    await this.contexts.createContext(CONTEXT_LEVELS.USER, user.id, (await this.contexts.ensureSystemContext()).id);
    return user;
  }

  async getByUsername(username: string): Promise<UserRow | undefined> { return this.repo.getByUsername(normalizeIdentity(username)); }
  async getByEmail(email: string): Promise<UserRow | undefined> { return this.repo.getByEmail(normalizeIdentity(email)); }
  async getByIdOrUndefined(id: string): Promise<UserRow | undefined> { return this.repo.getById(id); }

  async getUsersByIds(ids: string[]): Promise<UserRow[]> { return this.repo.getByIds(ids); }

  async listUsers(search: string | undefined, page = 1, pageSize = 20, filter: UserListFilter = {}): Promise<{ users: UserRow[]; total: number; page: number; pageSize: number }> {
    const { rows, total } = await this.repo.search(search, page, pageSize, filter);
    return { users: rows, total, page, pageSize };
  }

  async updateUser(id: string, input: { email?: string; firstName?: string; lastName?: string; password?: string; customFields?: Record<string, string> }, actorId?: string): Promise<UserRow> {
    if (input.password !== undefined && actorId !== undefined && actorId === id) {
      forbidden('Use the change-password flow with your current password to change your own password', 'user.password_self_change_forbidden');
    }
    const user = await this.getUser(id);
    if (input.customFields) await this.customFields.validateValuesForInstance(USER_COMPONENT, USER_AREA, input.customFields);
    if (user.deleted) badRequest('Cannot update a deleted user', 'user.deleted');
    const patch: UserPatch = {};
    if (input.email !== undefined) {
      const email = normalizeIdentity(input.email);
      const clash = await this.repo.getByEmail(email);
      if (clash && clash.id !== id) conflict(`Email ${email} is taken`, 'user.email_taken');
      patch.email = email;
    }
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.password !== undefined) {
      const errors = this.passwords.validatePolicy(input.password);
      if (errors.length) badRequest(errors.join('; '), 'user.password_policy');
      patch.passwordHash = await this.passwords.hash(input.password);
      patch.forcePasswordChange = false;
    }
    await this.repo.transaction(async (tx) => {
      await this.repo.updateUser(id, patch, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'user', type: 'user_updated', payload: { userId: id } });
    });
    if (input.password !== undefined) {
      await this.syncCredential(id);
      await this.authRepository.revokeAllForUser(id);
      await this.credentialBridge.revokeSessionsForUser(id);
      await this.sessions.destroyAllForUser(id);
    }
    if (input.customFields) await this.customFields.setValuesForInstance(USER_COMPONENT, USER_AREA, id, input.customFields);
    return this.getUser(id);
  }

  async setSuspended(id: string, suspended: boolean): Promise<UserRow> {
    const user = await this.getUser(id);
    if (user.isGuest) badRequest('The guest account cannot be suspended', 'user.guest_immutable');
    if (!suspended && user.suspended) {
      await this.planLimits.assertUserReactivationWithinSlotLimits(id);
    }
    await this.repo.transaction(async (tx) => {
      await this.repo.updateUser(id, { suspended }, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'user', type: suspended ? 'user_suspended' : 'user_unsuspended', payload: { userId: id } });
    });
    return this.getUser(id);
  }

  async deleteUser(id: string): Promise<UserRow> {
    const user = await this.getUser(id);
    if (user.isGuest) badRequest('The guest account cannot be deleted', 'user.guest_immutable');
    if (user.deleted) return user;
    await this.repo.transaction(async (tx) => {
      await this.repo.updateUser(id, {
        deleted: true, suspended: true,
        username: `${user.username}.deleted${id}`, email: `${user.email}.deleted${id}`,
      }, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'user', type: 'user_deleted', payload: { userId: id } });
    });
    return this.getUser(id);
  }

  async recordLogin(id: string): Promise<void> { await this.repo.updateUser(id, { lastLogin: new Date() }); }
  async clearForcePasswordChange(id: string): Promise<void> { await this.repo.updateUser(id, { forcePasswordChange: false }); }
  async verifyPassword(user: UserRow, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return this.passwords.verify(user.passwordHash, password);
  }
  async setPreference(userId: string, name: string, value: string | null): Promise<void> { return this.repo.setPreference(userId, name, value); }
  async getPreference(userId: string, name: string): Promise<string | null | undefined> { return this.repo.getPreference(userId, name); }

  async getProfileView(targetId: string, viewerId: string): Promise<UserProfileView> {
    const user = await this.getUser(targetId);
    const views = await this.getProfileViews([user], viewerId);
    return views[0]!;
  }

  async getProfileViews(targets: UserRow[], viewerId: string): Promise<UserProfileView[]> {
    if (!targets.length) return [];
    const systemCtx = await this.contexts.ensureSystemContext();
    const userCtxs = await this.contexts.getByLevelInstances(CONTEXT_LEVELS.USER, targets.map((u) => u.id));
    const ctxByUserId = new Map<string, ContextRow>();
    for (const ctx of userCtxs) {
      if (ctx.instanceId && !ctxByUserId.has(ctx.instanceId)) ctxByUserId.set(ctx.instanceId, ctx);
    }
    const canSeeAtSystem = await this.evaluator.hasCapability(viewerId, 'site:viewuseridentity', systemCtx.id);
    const capsByContextId = userCtxs.length
      ? await this.evaluator.resolveCapabilitiesForContexts(
        viewerId, userCtxs, new Map(userCtxs.map((c) => [c.id, c])),
      )
      : new Map<string, string[]>();
    const customByUser = await this.customFields.getValuesForInstances(
      USER_COMPONENT, USER_AREA, targets.map((u) => u.id),
    );
    return targets.map((user) => {
      const userCtx = ctxByUserId.get(user.id);
      const canSeeIdentity = viewerId === user.id
        || (userCtx ? (capsByContextId.get(userCtx.id) ?? []).includes('site:viewuseridentity') : false)
        || canSeeAtSystem;
      const custom = customByUser.get(user.id) ?? [];
      return {
        id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName,
        ...(canSeeIdentity ? { email: user.email } : {}),
        suspended: user.suspended, deleted: user.deleted, isGuest: user.isGuest,
        forcePasswordChange: user.forcePasswordChange, lastLogin: user.lastLogin, createdAt: user.createdAt,
        customFields: custom.map((c) => ({ shortName: c.field.shortName, name: c.field.name, type: c.field.type, value: c.value })),
      };
    });
  }

  async canViewUserIdentity(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    const systemCtx = await this.contexts.ensureSystemContext();
    if (await this.evaluator.hasCapability(viewerId, 'site:viewuseridentity', systemCtx.id)) return true;
    const [userCtx] = await this.contexts.getByLevelInstances(CONTEXT_LEVELS.USER, [targetId]);
    if (!userCtx) return false;
    return this.evaluator.hasCapability(viewerId, 'site:viewuseridentity', userCtx.id);
  }

  async assertCanUpdateProfile(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) return;
    const systemCtx = await this.contexts.ensureSystemContext();
    if (!(await this.evaluator.hasCapability(actorId, 'user:update', systemCtx.id))) {
      forbidden('Missing capability user:update', 'access.capability_denied');
    }
  }
}
