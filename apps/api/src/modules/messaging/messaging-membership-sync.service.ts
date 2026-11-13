import { MessagingRepository, type ConversationRow } from '@giaokhoa/db/repositories/messaging';
import { MessagingRealtimeService } from './messaging-realtime.service';
import type { PermissionEvaluator } from '../access/permission-evaluator.service';

export class MessagingMembershipSyncService {
  constructor(
    private readonly repo: MessagingRepository,
    private readonly realtime: MessagingRealtimeService,
    private readonly evaluator?: PermissionEvaluator,
  ) {}


  isGroupLinked(conversation: ConversationRow): boolean {
    return conversation.type === 2
      && conversation.component === 'core_group'
      && conversation.itemType === 'groups'
      && conversation.itemId !== null;
  }

  isCourseLinked(conversation: ConversationRow): boolean {
    return conversation.type === 2
      && conversation.component === 'core_course'
      && conversation.itemType === 'course'
      && conversation.itemId !== null;
  }

  isClassLinked(conversation: ConversationRow): boolean {
    return conversation.type === 2
      && conversation.component === 'core_class'
      && conversation.itemType === 'class'
      && conversation.itemId !== null;
  }

  async syncLinkedConversationMembers(conversation: ConversationRow, targetIds: string[]): Promise<string[]> {
    const memberIds = [...new Set(targetIds)];
    const current = await this.repo.listMembers(conversation.id);
    for (const id of memberIds) {
      if (!current.includes(id)) await this.repo.addMember(conversation.id, id);
    }
    const preserved: string[] = [];
    for (const id of current) {
      if (memberIds.includes(id)) continue;
      if (
        this.evaluator
        && (this.isClassLinked(conversation) || this.isCourseLinked(conversation))
        && (await this.evaluator.isSiteAdmin(id))
      ) {
        preserved.push(id);
        continue;
      }
      await this.repo.removeMember(conversation.id, id);
      await this.realtime.evictUserFromConversation(id, conversation.id);
    }
    return [...new Set([...memberIds, ...preserved])];
  }

  async syncGroupConversationMembers(conversation: ConversationRow): Promise<string[]> {
    return this.syncLinkedConversationMembers(conversation, await this.repo.listGroupMemberIds(conversation.itemId!));
  }

  async syncCourseConversationMembers(conversation: ConversationRow): Promise<string[]> {
    return this.syncLinkedConversationMembers(conversation, await this.repo.listCourseConversationMemberIds(conversation.itemId!));
  }

  async syncClassConversationMembers(conversation: ConversationRow): Promise<string[]> {
    const cls = await this.repo.getClassSummary(conversation.itemId!);
    if (!cls || cls.status !== 'active') return this.repo.listMembers(conversation.id);
    return this.syncLinkedConversationMembers(conversation, await this.repo.listClassConversationMemberIds(conversation.itemId!));
  }

  async syncGroupConversationIfLinked(conversation: ConversationRow): Promise<void> {
    if (this.isGroupLinked(conversation)) await this.syncGroupConversationMembers(conversation);
    else if (this.isCourseLinked(conversation)) await this.syncCourseConversationMembers(conversation);
    else if (this.isClassLinked(conversation)) await this.syncClassConversationMembers(conversation);
  }
}
