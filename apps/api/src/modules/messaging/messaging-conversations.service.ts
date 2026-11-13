import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { UsersService } from '../users/users.service';
import { MessagingRepository, type ConversationRow, type MessageRow, type MessageWithQuoteRow } from '@giaokhoa/db/repositories/messaging';
import { blankRecalledContent } from '@giaokhoa/messaging';
import { tenantAls } from '../tenants/tenant-als';
import { MessagingContactsService, type PersonSummaryView } from './messaging-contacts.service';
import { MessagingMembershipSyncService } from './messaging-membership-sync.service';

export class MessagingConversationsService {
  constructor(
    private readonly repo: MessagingRepository,
    private readonly users: UsersService,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly contacts: MessagingContactsService,
    private readonly membershipSync: MessagingMembershipSyncService,
  ) {}


  async canCreateFreeGroup(actorId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(actorId)) return true;
    const tenantId = tenantAls.getStore()?.tenantId;
    if (!tenantId) return false;
    const tenantCtx = await this.contexts.getByLevelInstance(20, tenantId);
    if (!tenantCtx) return false;
    if (await this.evaluator.hasCapability(actorId, 'tenant:manage', tenantCtx.id)) return true;
    const systemCtx = await this.contexts.ensureSystemContext();
    return this.evaluator.hasCapability(actorId, 'tenant:manage', systemCtx.id);
  }

  async createConversation(actorId: string, input: { type?: number; memberIds: string[]; name?: string }): Promise<ConversationRow & { members: string[] }> {
    const type = input.type ?? 1;
    const memberIds = [...new Set([actorId, ...input.memberIds])];
    if (type === 1) {
      if (memberIds.length !== 2) throw new BadRequestException({ message: 'An individual conversation has exactly 2 members', code: 'messaging.individual_members' });
      const other = memberIds.find((id) => id !== actorId)!;
      const existing = await this.repo.findIndividualConversation(actorId, other);
      if (existing) return { ...existing, members: await this.repo.listMembers(existing.id) };
    }
    if (type === 2 && memberIds.length < 2) {
      throw new BadRequestException({ message: 'A group conversation needs at least 2 members', code: 'messaging.group_members' });
    }
    for (const id of memberIds) await this.users.getUser(id);
    if (type === 1) {
      const other = memberIds.find((id) => id !== actorId)!;
      await this.contacts.assertCanContact(actorId, other);
    }
    if (type === 2) {
      if (!(await this.canCreateFreeGroup(actorId))) {
        throw new ForbiddenException({
          message: 'Only site administrators or centre owners can create group conversations',
          code: 'messaging.group_creation_forbidden',
        });
      }
    }
    const conversation = await this.repo.transaction(async (tx) => {
      const created = await this.repo.insertConversation({ type, name: input.name ?? null, createdBy: actorId, tenantId: tenantAls.getStore()?.tenantId ?? null }, tx);
      for (const id of memberIds) await this.repo.addMember(created.id, id, tx);
      return created;
    });
    return { ...conversation, members: memberIds };
  }

  async assertConversationMember(userId: string, conversation: ConversationRow): Promise<void> {
    if (await this.repo.isMember(conversation.id, userId)) return;
    if (this.membershipSync.isCourseLinked(conversation) || this.membershipSync.isClassLinked(conversation)) {
      throw new NotFoundException({ message: `Conversation ${conversation.id} not found`, code: 'messaging.conversation_not_found' });
    }
    throw new ForbiddenException({ message: 'You are not a member of this conversation', code: 'messaging.not_member' });
  }

  private async isCourseStaff(userId: string, courseId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    const courseCtx = await this.contexts.getByLevelInstance(50, courseId);
    if (!courseCtx) return false;
    return this.evaluator.hasCapability(userId, 'course:managegroups', courseCtx.id);
  }

  private async isClassStaff(userId: string, classId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    const staff = await this.repo.listClassStaffUserIds(classId);
    return staff.includes(userId);
  }

  async createGroupConversation(actorId: string, input: { groupId: string; name?: string }): Promise<ConversationRow & { members: string[] }> {
    const group = await this.repo.getCourseGroup(input.groupId);
    if (!group) throw new NotFoundException({ message: `Course group ${input.groupId} not found`, code: 'messaging.group_not_found' });
    const groupMemberIds = await this.repo.listGroupMemberIds(group.id);
    if (!groupMemberIds.includes(actorId) && !(await this.isCourseStaff(actorId, group.courseId))) {
      throw new ForbiddenException({ message: 'Only group members or course staff can create the group conversation', code: 'messaging.group_conversation_forbidden' });
    }
    const existing = await this.repo.findGroupConversation(group.id);
    if (existing) return { ...existing, members: await this.membershipSync.syncGroupConversationMembers(existing) };
    const courseCtx = await this.contexts.getByLevelInstance(50, group.courseId);
    const tenantId = (await this.repo.getCourseTenantId(group.courseId)) ?? tenantAls.getStore()?.tenantId ?? null;
    const conversation = await this.repo.transaction(async (tx) => {
      const created = await this.repo.insertConversation({
        type: 2, name: input.name ?? group.name,
        component: 'core_group', itemType: 'groups', itemId: group.id,
        contextId: courseCtx?.id ?? null, createdBy: actorId, tenantId,
      }, tx);
      for (const id of groupMemberIds) await this.repo.addMember(created.id, id, tx);
      return created;
    });
    return { ...conversation, members: groupMemberIds };
  }


  async ensureCourseConversation(actorId: string, courseId: string): Promise<ConversationRow & { members: string[] }> {
    const course = await this.repo.getCourseSummary(courseId);
    if (!course) throw new NotFoundException({ message: `Course ${courseId} not found`, code: 'messaging.course_not_found' });
    if (!(await this.repo.isCourseMember(courseId, actorId)) && !(await this.isCourseStaff(actorId, courseId))) {
      throw new NotFoundException({ message: `Course ${courseId} not found`, code: 'messaging.course_not_found' });
    }
    const existing = await this.repo.findCourseConversation(courseId);
    let conversation: ConversationRow;
    let members: string[];
    if (existing) {
      conversation = existing;
      members = await this.membershipSync.syncCourseConversationMembers(existing);
    } else {
      const courseCtx = await this.contexts.getByLevelInstance(50, courseId);
      const memberIds = await this.repo.listCourseConversationMemberIds(courseId);
      const ensured = await this.repo.transaction(async (tx) => {
        await this.repo.acquireCourseConversationLock(tx, courseId);
        const rechecked = await this.repo.findCourseConversation(courseId, tx);
        if (rechecked) return { conversation: rechecked, created: false as const };
        const created = await this.repo.insertConversation({
          type: 2, name: course.fullName,
          component: 'core_course', itemType: 'course', itemId: courseId,
          contextId: courseCtx?.id ?? null, createdBy: actorId,
        }, tx);
        for (const id of memberIds) await this.repo.addMember(created.id, id, tx);
        return { conversation: created, created: true as const };
      });
      conversation = ensured.conversation;
      members = ensured.created
        ? memberIds
        : await this.membershipSync.syncCourseConversationMembers(ensured.conversation);
    }
    members = await this.grantScopeHolderMembership(actorId, members, conversation.id);
    return { ...conversation, members };
  }

  private async grantScopeHolderMembership(actorId: string, members: string[], conversationId: string): Promise<string[]> {
    if (members.includes(actorId)) return members;
    await this.repo.addMember(conversationId, actorId);
    return [...members, actorId];
  }


  async ensureClassConversation(actorId: string, classId: string): Promise<ConversationRow & { members: string[] }> {
    const cls = await this.repo.getClassSummary(classId);
    if (!cls || cls.status !== 'active') {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'messaging.class_not_found' });
    }
    if (!(await this.repo.isClassMember(classId, actorId)) && !(await this.isClassStaff(actorId, classId))) {
      throw new NotFoundException({ message: `Class ${classId} not found`, code: 'messaging.class_not_found' });
    }
    const existing = await this.repo.findClassConversation(classId);
    let conversation: ConversationRow;
    let members: string[];
    if (existing) {
      conversation = existing;
      members = await this.membershipSync.syncClassConversationMembers(existing);
    } else {
      const classCtx = await this.contexts.getByLevelInstance(45, classId);
      const memberIds = await this.repo.listClassConversationMemberIds(classId);
      const ensured = await this.repo.transaction(async (tx) => {
        await this.repo.acquireClassConversationLock(tx, classId);
        const rechecked = await this.repo.findClassConversation(classId, tx);
        if (rechecked) return { conversation: rechecked, created: false as const };
        const created = await this.repo.insertConversation({
          type: 2, name: cls.name,
          component: 'core_class', itemType: 'class', itemId: classId,
          contextId: classCtx?.id ?? null, createdBy: actorId, tenantId: cls.tenantId,
        }, tx);
        for (const id of memberIds) await this.repo.addMember(created.id, id, tx);
        return { conversation: created, created: true as const };
      });
      conversation = ensured.conversation;
      members = ensured.created
        ? memberIds
        : await this.membershipSync.syncClassConversationMembers(ensured.conversation);
    }
    members = await this.grantScopeHolderMembership(actorId, members, conversation.id);
    return { ...conversation, members };
  }


  async resolveConversationCourseId(conversation: ConversationRow): Promise<string | null> {
    if (this.membershipSync.isClassLinked(conversation)) return null;
    if (this.membershipSync.isCourseLinked(conversation)) return conversation.itemId;
    if (this.membershipSync.isGroupLinked(conversation)) {
      const group = await this.repo.getCourseGroup(conversation.itemId!);
      if (group) return group.courseId;
    }
    if (conversation.contextId) {
      const ctx = await this.contexts.getContext(conversation.contextId).catch(() => undefined);
      if (ctx && ctx.contextLevel === 50) return ctx.instanceId;
    }
    const members = await this.repo.listMembers(conversation.id);
    if (!members.length) return null;
    let common: string[] | null = null;
    for (const memberId of members) {
      const courses = await this.repo.activeCourseIds(memberId);
      common = common === null ? [...courses] : common.filter((id) => courses.includes(id));
      if (!common.length) return null;
    }
    return common?.sort()[0] ?? null;
  }

  async resolveConversationClassId(conversation: ConversationRow): Promise<string | null> {
    if (this.membershipSync.isClassLinked(conversation)) return conversation.itemId;
    if (conversation.contextId) {
      const ctx = await this.contexts.getContext(conversation.contextId).catch(() => undefined);
      if (ctx && ctx.contextLevel === 45) return ctx.instanceId;
    }
    return null;
  }

  async canModerateConversation(userId: string, conversation: ConversationRow): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    const courseId = await this.resolveConversationCourseId(conversation);
    if (courseId) {
      const staff = await this.repo.listCourseStaffUserIds(courseId);
      if (staff.includes(userId)) return true;
    }
    const classId = await this.resolveConversationClassId(conversation);
    if (classId) {
      const staff = await this.repo.listClassStaffUserIds(classId);
      if (staff.includes(userId)) return true;
    }
    return false;
  }

  async canManageConversation(userId: string, conversation: ConversationRow): Promise<boolean> {
    if (await this.canModerateConversation(userId, conversation)) return true;
    if (!this.membershipSync.isGroupLinked(conversation) && !this.membershipSync.isCourseLinked(conversation) && !this.membershipSync.isClassLinked(conversation) && conversation.createdBy !== null && conversation.createdBy === userId) return true;
    return false;
  }

  async updateConversation(actorId: string, conversationId: string, input: { enabled: boolean }): Promise<ConversationRow & { members: string[] }> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    if (!(await this.canManageConversation(actorId, conversation))) {
      throw new ForbiddenException({
        message: 'Only the teacher in charge, course staff, an administrator, or the group creator can change this conversation',
        code: 'messaging.conversation_manage_forbidden',
      });
    }
    const updated = await this.repo.setConversationEnabled(conversationId, input.enabled);
    return { ...updated!, members: await this.repo.listMembers(conversationId) };
  }

  async removeConversationMember(actorId: string, conversationId: string, targetUserId: string): Promise<ConversationRow & { members: string[] }> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    if (!(await this.canManageConversation(actorId, conversation))) {
      throw new ForbiddenException({
        message: 'Only the teacher in charge, course staff, an administrator, or the group creator can change this conversation',
        code: 'messaging.conversation_manage_forbidden',
      });
    }
    if (conversation.type !== 2 || this.membershipSync.isGroupLinked(conversation) || this.membershipSync.isCourseLinked(conversation) || this.membershipSync.isClassLinked(conversation)) {
      throw new BadRequestException({
        message: 'Members of a class, course or course-group conversation come from its roster — manage them on the roster screen, not in chat',
        code: 'messaging.member_remove_structural',
      });
    }
    if (targetUserId === actorId) {
      throw new BadRequestException({ message: 'You cannot remove yourself from the group', code: 'messaging.member_remove_self' });
    }
    if (conversation.createdBy !== null && conversation.createdBy === targetUserId) {
      throw new ForbiddenException({ message: 'The group creator cannot be removed', code: 'messaging.member_remove_creator' });
    }
    if (!(await this.repo.isMember(conversationId, targetUserId))) {
      throw new NotFoundException({ message: `User ${targetUserId} is not a member of conversation ${conversationId}`, code: 'messaging.member_not_found' });
    }
    await this.repo.removeMember(conversationId, targetUserId);
    const updated = await this.repo.getConversation(conversationId);
    return { ...updated!, members: await this.repo.listMembers(conversationId) };
  }

  async updateConversationState(
    userId: string,
    conversationId: string,
    input: { pinned?: boolean; archived?: boolean; muted?: boolean },
  ): Promise<{ conversationId: string; pinned: boolean; pinnedAt: Date | null; archived: boolean; archivedAt: Date | null; muted: boolean }> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    if (!(await this.repo.isMember(conversationId, userId))) {
      throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    }
    await this.assertDirectConversationVisible(userId, conversation);
    const state = await this.repo.updateMemberConversationState(conversationId, userId, input);
    if (!state) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    return {
      conversationId,
      pinned: state.pinnedAt !== null,
      pinnedAt: state.pinnedAt,
      archived: state.archivedAt !== null,
      archivedAt: state.archivedAt,
      muted: state.muted,
    };
  }

  async listConversations(userId: string, opts: { archivedOnly?: boolean } = {}): Promise<(ConversationRow & {
    members: string[]; unread: number; lastReadSeq: number; lastMessage: MessageRow | null;
    pinnedAt: Date | null; archivedAt: Date | null; muted: boolean;
    memberProfiles: Record<string, PersonSummaryView>;
  })[]> {
    for (const c of await this.repo.listGroupConversationsForGroupMember(userId)) {
      await this.membershipSync.syncGroupConversationMembers(c);
    }
    for (const c of await this.repo.listCourseConversationsForMember(userId)) {
      await this.membershipSync.syncCourseConversationMembers(c);
    }
    for (const c of await this.repo.listClassConversationsForMember(userId)) {
      await this.membershipSync.syncClassConversationMembers(c);
    }
    const summaries = await this.repo.listConversationSummaries(userId, opts);
    const myGroupIds = new Set(await this.repo.listGroupIdsForUser(userId));
    const out: (ConversationRow & {
      members: string[]; unread: number; lastReadSeq: number; lastMessage: MessageRow | null;
      pinnedAt: Date | null; archivedAt: Date | null; muted: boolean;
    })[] = [];
    for (const s of summaries) {
      if (this.membershipSync.isGroupLinked(s.conversation) && !myGroupIds.has(s.conversation.itemId!)) {
        await this.membershipSync.syncGroupConversationMembers(s.conversation);
        continue;
      }
      if (this.membershipSync.isCourseLinked(s.conversation)) {
        const memberIds = await this.repo.listCourseConversationMemberIds(s.conversation.itemId!);
        if (!memberIds.includes(userId) && !(await this.isCourseStaff(userId, s.conversation.itemId!))) {
          await this.membershipSync.syncCourseConversationMembers(s.conversation);
          continue;
        }
      }
      if (this.membershipSync.isClassLinked(s.conversation)) {
        const memberIds = await this.repo.listClassConversationMemberIds(s.conversation.itemId!);
        if (!memberIds.includes(userId) && !(await this.isClassStaff(userId, s.conversation.itemId!))) {
          await this.membershipSync.syncClassConversationMembers(s.conversation);
          continue;
        }
      }
      out.push({
        ...s.conversation,
        members: s.members,
        unread: s.unreadCount,
        lastReadSeq: s.lastReadSeq,
        pinnedAt: s.pinnedAt,
        archivedAt: s.archivedAt,
        muted: s.muted,
        lastMessage: s.lastMessage ? blankRecalledContent(s.lastMessage) : null,
      });
    }
    if (!opts.archivedOnly) {
      const seenIds = new Set(out.map((entry) => entry.id));
      for (const conversation of await this.repo.listCourseAndClassConversations()) {
        if (seenIds.has(conversation.id)) continue;
        const myState = await this.repo.getMemberConversationState(conversation.id, userId);
        if (myState?.archivedAt) continue;
        if (this.membershipSync.isCourseLinked(conversation)) {
          if (!(await this.isCourseStaff(userId, conversation.itemId!))) continue;
          out.push({
            ...conversation,
            members: await this.repo.listCourseConversationMemberIds(conversation.itemId!),
            unread: 0,
            lastReadSeq: 0,
            pinnedAt: null,
            archivedAt: null,
            muted: false,
            lastMessage: null,
          });
        } else if (this.membershipSync.isClassLinked(conversation)) {
          if (!(await this.isClassStaff(userId, conversation.itemId!))) continue;
          out.push({
            ...conversation,
            members: await this.repo.listClassConversationMemberIds(conversation.itemId!),
            unread: 0,
            lastReadSeq: 0,
            pinnedAt: null,
            archivedAt: null,
            muted: false,
            lastMessage: null,
          });
        }
      }
    }
    const profiles = await this.contacts.profilesFor(out.flatMap((entry) => entry.members));
    return out.map((entry) => ({
      ...entry,
      memberProfiles: Object.fromEntries(
        entry.members.filter((id) => profiles[id]).map((id) => [id, profiles[id]!]),
      ),
    }));
  }

  async assertDirectConversationVisible(userId: string, conversation: ConversationRow): Promise<void> {
    if (conversation.type !== 1) return;
    const members = await this.repo.listMembers(conversation.id);
    const other = members.find((id) => id !== userId);
    if (!other) return;
    if ((await this.repo.listBlockedCounterpartIds(userId)).includes(other)) {
      throw new NotFoundException({ message: `Conversation ${conversation.id} not found`, code: 'messaging.conversation_not_found' });
    }
  }

  async getConversation(userId: string, conversationId: string, opts: { limit?: number } = {}): Promise<ConversationRow & {
    members: string[]; messages: MessageWithQuoteRow[]; hasMoreBefore: boolean;
    lastReadSeq: number; memberReadMarkers: { userId: string; lastReadSeq: number }[];
    memberProfiles: Record<string, PersonSummaryView>;
    canModerate: boolean; canManage: boolean;
    pinnedAt: Date | null; archivedAt: Date | null; muted: boolean;
  }> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.assertConversationMember(userId, conversation);
    await this.assertDirectConversationVisible(userId, conversation);
    const canModerate = await this.canModerateConversation(userId, conversation);
    const canManage = canModerate || await this.canManageConversation(userId, conversation);
    const rawMessages = await this.repo.listMessages(conversationId, {
      limit: opts.limit ?? 50,
      includeDeleted: canModerate,
      viewerId: canModerate ? undefined : userId,
    });
    const withQuotes = await this.repo.attachQuotes(rawMessages, {
      privileged: canModerate,
      viewerId: canModerate ? undefined : userId,
    });
    const messages = canModerate ? withQuotes : withQuotes.map((m) => ({ ...blankRecalledContent(m), replyTo: m.replyTo }));
    const markers = await this.repo.listMemberReadMarkers(conversationId);
    const members = await this.repo.listMembers(conversationId);
    const myState = await this.repo.getMemberConversationState(conversationId, userId);
    return {
      ...conversation,
      pinnedAt: myState?.pinnedAt ?? null,
      archivedAt: myState?.archivedAt ?? null,
      muted: myState?.muted ?? false,
      members,
      messages,
      hasMoreBefore: messages.length > 0 ? await this.repo.hasMessagesBefore(conversationId, messages[0]!.seq, canModerate, canModerate ? undefined : userId) : false,
      lastReadSeq: markers.find((m) => m.userId === userId)?.lastReadSeq ?? 0,
      memberReadMarkers: markers,
      memberProfiles: await this.contacts.profilesFor(members),
      canModerate,
      canManage,
    };
  }
}
