import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type MessageEvent } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import type { Queue } from 'bullmq';
import type { Observable } from 'rxjs';
import type { NotificationGroupPage, NotificationItemPage } from '@giaokhoa/contracts';
import type { ListNotificationGroupsQueryDto, ListNotificationItemsQueryDto, ReadNotificationGroupDto } from './dto/messaging.dto';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { SiteConfigService } from '../site-config/site-config.service';
import { UsersService } from '../users/users.service';
import { MessagingRepository, type ConversationRow, type MessageRow, type MessageWithQuoteRow, type ReportRow } from '@giaokhoa/db/repositories/messaging';
import { MessagingRealtimeService } from './messaging-realtime.service';
import { MessagingSendThrottleService } from './messaging-send-throttle.service';
import { NotificationUnreadStreamService } from './notification-unread-stream.service';
import {
  type EmailFrequency,
  type LoginState,
  type MessageChannel,
  type MessageProviderDefinition,
  type NotificationAudience,
  type NotificationCourseOverrideMode,
  type NotificationCourseOverrideView,
  type NotificationPreferenceView,
  type NotifyResult,
} from './notification-providers';
import { MessagingContactsService, type PersonSummaryView } from './messaging-contacts.service';
import { MessagingConversationsService } from './messaging-conversations.service';
import { MessagingGroupTreeService, type ClassRosterMemberView, type ConversationGroupTreeView, type CourseRosterMemberView, type MessagingCourseView } from './messaging-group-tree.service';
import { MessagingMembershipSyncService } from './messaging-membership-sync.service';
import { MessagingMessagesService } from './messaging-messages.service';
import { MessagingNotificationsService, NOTIFICATION_DISPATCH_QUEUE } from './messaging-notifications.service';

export {
  MESSAGE_CHANNELS,
  MESSAGE_PROVIDERS,
  providerByName,
  externalPolicyOf,
  providerVisibleToAudiences,
  isTeacherOnlyProvider,
  preferenceName,
  preferenceNameV2,
  coursePreferenceName,
  isExemptFromCourseMute,
  EMAIL_CHANNEL_AVAILABLE,
  NOTIFICATION_POLICY_COMPONENT,
  notificationPolicySettingName,
  MANDATORY_NOTIFICATION_PROVIDERS,
  type MessageChannel,
  type LoginState,
  type MessageProviderGroup,
  type EmailFrequency,
  type ExternalContentPolicy,
  type MessageProviderDefinition,
  type NotificationAudience,
  type NotificationPreferenceView,
  type NotifyResult,
  type NotificationCourseOverrideMode,
  type NotificationCourseOverrideView,
} from './notification-providers';

export { NOTIFICATION_DISPATCH_QUEUE, type NotificationChannelPort } from './messaging-notifications.service';
export { displayNameOf, type ContactRelationship, type PersonSummaryView } from './messaging-contacts.service';
export {
  ROSTER_DEFAULT_PAGE_SIZE,
  ROSTER_MAX_PAGE_SIZE,
  type ClassRosterMemberView,
  type ConversationGroupTreeView,
  type ConversationTreeClassView,
  type ConversationTreeCourseView,
  type ConversationTreeFreeGroupView,
  type ConversationTreeGroupView,
  type ConversationTreeRole,
  type CourseRosterMemberView,
  type MessagingCourseView,
} from './messaging-group-tree.service';
export { countUserVisibleCharacters, isWithinRecallWindow } from './messaging-messages.service';


@Injectable()
export class MessagingService {
  private readonly notifications: MessagingNotificationsService;
  private readonly contacts: MessagingContactsService;
  private readonly groupTree: MessagingGroupTreeService;
  private readonly conversations: MessagingConversationsService;
  private readonly messages: MessagingMessagesService;

  constructor(
    private readonly repo: MessagingRepository,
    private readonly users: UsersService,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly outbox: OutboxService,
    private readonly realtime: MessagingRealtimeService,
    private readonly unreadStream: NotificationUnreadStreamService,
    @InjectQueue(NOTIFICATION_DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
    private readonly siteConfig: SiteConfigService,
    private readonly sendThrottle: MessagingSendThrottleService,
    private readonly i18n: I18nService,
  ) {
    const membershipSync = new MessagingMembershipSyncService(this.repo, this.realtime, this.evaluator);
    this.groupTree = new MessagingGroupTreeService(this.repo, membershipSync);
    this.notifications = new MessagingNotificationsService(
      this.repo, this.users, this.evaluator, this.outbox, this.unreadStream,
      this.dispatchQueue, this.siteConfig, this.groupTree, this.i18n,
    );
    this.contacts = new MessagingContactsService(this.repo, this.users, this.realtime, this.notifications);
    this.conversations = new MessagingConversationsService(
      this.repo, this.users, this.evaluator, this.contexts, this.contacts, membershipSync,
    );
    this.messages = new MessagingMessagesService(
      this.repo, this.users, this.evaluator, this.contexts, this.outbox, this.siteConfig,
      this.sendThrottle, this.conversations, this.contacts, this.notifications, membershipSync,
    );
  }

  async isProviderEnabledBySitePolicy(provider: MessageProviderDefinition): Promise<boolean> {
    return this.notifications.isProviderEnabledBySitePolicy(provider);
  }

  async hasFullNotificationPreferences(userId: string): Promise<boolean> {
    return this.notifications.hasFullNotificationPreferences(userId);
  }

  async resolvePreferenceAudiences(userId: string): Promise<Set<NotificationAudience>> {
    return this.notifications.resolvePreferenceAudiences(userId);
  }

  async isChannelEnabled(userId: string, provider: string, channel: MessageChannel, state: LoginState): Promise<boolean> {
    return this.notifications.isChannelEnabled(userId, provider, channel, state);
  }

  async resolveNotificationPreference(userId: string, provider: MessageProviderDefinition): Promise<{ popupEnabled: boolean; emailFrequency: EmailFrequency | null }> {
    return this.notifications.resolveNotificationPreference(userId, provider);
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceView[]> {
    return this.notifications.getPreferences(userId);
  }

  async setPreference(userId: string, input: { provider: string; popupEnabled?: boolean; emailFrequency?: EmailFrequency }): Promise<NotificationPreferenceView> {
    return this.notifications.setPreference(userId, input);
  }

  async getCourseOverrideMode(userId: string, courseId: string): Promise<NotificationCourseOverrideMode> {
    return this.notifications.getCourseOverrideMode(userId, courseId);
  }

  async listCourseNotificationOverrides(userId: string): Promise<NotificationCourseOverrideView[]> {
    return this.notifications.listCourseNotificationOverrides(userId);
  }

  async setCourseNotificationOverride(
    userId: string,
    input: { courseId: string; mode: NotificationCourseOverrideMode },
  ): Promise<NotificationCourseOverrideView> {
    return this.notifications.setCourseNotificationOverride(userId, input);
  }

  async notify(userId: string, providerName: string, input: {
    subject: string; body: string; contextUrl?: string; fromUserId?: string; loggedIn?: boolean;
    externalSubject?: string; externalBody?: string;
    forceExternalMinimized?: boolean;
    courseId?: string;
    tenantId?: string | null;
  }): Promise<NotifyResult> {
    return this.notifications.notify(userId, providerName, input);
  }

  async sendSystemNotification(actorId: string, dto: { userId: string; provider: string; subject: string; body: string; contextUrl?: string }): Promise<NotifyResult> {
    return this.notifications.sendSystemNotification(actorId, dto);
  }

  async listNotificationGroups(userId: string, query: ListNotificationGroupsQueryDto): Promise<NotificationGroupPage> {
    return this.notifications.listNotificationGroups(userId, query);
  }

  async listNotificationItems(userId: string, query: ListNotificationItemsQueryDto): Promise<NotificationItemPage> {
    return this.notifications.listNotificationItems(userId, query);
  }

  async markNotificationGroupRead(userId: string, dto: ReadNotificationGroupDto): Promise<{ marked: number }> {
    return this.notifications.markNotificationGroupRead(userId, dto);
  }

  async deleteNotification(userId: string, notificationId: string): Promise<{ deleted: boolean }> {
    return this.notifications.deleteNotification(userId, notificationId);
  }

  async clearReadNotifications(userId: string): Promise<{ deleted: number }> {
    return this.notifications.clearReadNotifications(userId);
  }

  async unreadNotificationCount(userId: string): Promise<number> {
    return this.notifications.unreadNotificationCount(userId);
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<{ read: boolean }> {
    return this.notifications.markNotificationRead(userId, notificationId);
  }

  async markAllNotificationsRead(userId: string): Promise<{ marked: number }> {
    return this.notifications.markAllNotificationsRead(userId);
  }

  unreadCountStream(userId: string): Observable<MessageEvent> {
    return this.notifications.unreadCountStream(userId);
  }

  async listDispatchLog(userId: string) {
    return this.notifications.listDispatchLog(userId);
  }


  async requestContact(userId: string, contactId: string): Promise<{ status: 'pending' | 'accepted'; contacts: string[] }> {
    return this.contacts.requestContact(userId, contactId);
  }

  async listContactRequests(userId: string): Promise<{
    incoming: { userId: string; createdAt: Date; displayName: string; username: string }[];
    outgoing: { userId: string; createdAt: Date; displayName: string; username: string }[];
  }> {
    return this.contacts.listContactRequests(userId);
  }

  async profilesFor(userIds: string[]): Promise<Record<string, PersonSummaryView>> {
    return this.contacts.profilesFor(userIds);
  }

  async acceptContactRequest(userId: string, requesterId: string): Promise<{ contacts: string[] }> {
    return this.contacts.acceptContactRequest(userId, requesterId);
  }

  async declineContactRequest(userId: string, requesterId: string): Promise<{ declined: boolean }> {
    return this.contacts.declineContactRequest(userId, requesterId);
  }

  async removeContact(userId: string, contactId: string): Promise<{ contacts: string[] }> {
    return this.contacts.removeContact(userId, contactId);
  }

  async listContacts(userId: string): Promise<string[]> {
    return this.contacts.listContacts(userId);
  }

  async getPersonProfile(viewerId: string, targetId: string): Promise<{ userId: string; displayName: string; username: string; email: string }> {
    return this.contacts.getPersonProfile(viewerId, targetId);
  }


  async listMyMessagingCourses(actorId: string): Promise<MessagingCourseView[]> {
    return this.groupTree.listMyMessagingCourses(actorId);
  }

  async getGroupTree(actorId: string): Promise<ConversationGroupTreeView> {
    const canCreateFreeGroup = await this.conversations.canCreateFreeGroup(actorId);
    return this.groupTree.getGroupTree(actorId, canCreateFreeGroup);
  }

  async listCourseRoster(actorId: string, courseId: string, query: { limit?: number; cursor?: string }): Promise<{
    members: CourseRosterMemberView[];
    nextCursor: string | null;
  }> {
    return this.groupTree.listCourseRoster(actorId, courseId, query);
  }

  async listClassRoster(actorId: string, classId: string, query: { limit?: number; cursor?: string }): Promise<{
    members: ClassRosterMemberView[];
    nextCursor: string | null;
  }> {
    return this.groupTree.listClassRoster(actorId, classId, query);
  }


  async blockContact(userId: string, blockedUserId: string): Promise<{ blocked: string[] }> {
    return this.contacts.blockContact(userId, blockedUserId);
  }

  async unblockContact(userId: string, blockedUserId: string): Promise<{ blocked: string[] }> {
    return this.contacts.unblockContact(userId, blockedUserId);
  }

  async listBlocked(userId: string): Promise<string[]> {
    return this.contacts.listBlocked(userId);
  }

  async isBlockedBy(blockerId: string, senderId: string): Promise<boolean> {
    return this.contacts.isBlockedBy(blockerId, senderId);
  }


  async createConversation(actorId: string, input: { type?: number; memberIds: string[]; name?: string }): Promise<ConversationRow & { members: string[] }> {
    return this.conversations.createConversation(actorId, input);
  }

  async createGroupConversation(actorId: string, input: { groupId: string; name?: string }): Promise<ConversationRow & { members: string[] }> {
    return this.conversations.createGroupConversation(actorId, input);
  }

  async ensureCourseConversation(actorId: string, courseId: string): Promise<ConversationRow & { members: string[] }> {
    return this.conversations.ensureCourseConversation(actorId, courseId);
  }

  async ensureClassConversation(actorId: string, classId: string): Promise<ConversationRow & { members: string[] }> {
    return this.conversations.ensureClassConversation(actorId, classId);
  }

  async updateConversation(actorId: string, conversationId: string, input: { enabled: boolean }): Promise<ConversationRow & { members: string[] }> {
    return this.conversations.updateConversation(actorId, conversationId, input);
  }

  async removeConversationMember(actorId: string, conversationId: string, targetUserId: string): Promise<ConversationRow & { members: string[] }> {
    return this.conversations.removeConversationMember(actorId, conversationId, targetUserId);
  }

  async updateConversationState(
    userId: string,
    conversationId: string,
    input: { pinned?: boolean; archived?: boolean; muted?: boolean },
  ): Promise<{ conversationId: string; pinned: boolean; pinnedAt: Date | null; archived: boolean; archivedAt: Date | null; muted: boolean }> {
    return this.conversations.updateConversationState(userId, conversationId, input);
  }

  async listConversations(userId: string, opts: { archivedOnly?: boolean } = {}): Promise<(ConversationRow & {
    members: string[]; unread: number; lastReadSeq: number; lastMessage: MessageRow | null;
    pinnedAt: Date | null; archivedAt: Date | null; muted: boolean;
    memberProfiles: Record<string, PersonSummaryView>;
  })[]> {
    return this.conversations.listConversations(userId, opts);
  }

  async getConversation(userId: string, conversationId: string, opts: { limit?: number } = {}): Promise<ConversationRow & {
    members: string[]; messages: MessageWithQuoteRow[]; hasMoreBefore: boolean;
    lastReadSeq: number; memberReadMarkers: { userId: string; lastReadSeq: number }[];
    memberProfiles: Record<string, PersonSummaryView>;
    canModerate: boolean; canManage: boolean;
  }> {
    return this.conversations.getConversation(userId, conversationId, opts);
  }


  async listConversationMessages(userId: string, conversationId: string, query: {
    beforeSeq?: number; afterSeq?: number; limit?: number;
  }): Promise<{ messages: MessageWithQuoteRow[]; hasMoreBefore: boolean }> {
    return this.messages.listConversationMessages(userId, conversationId, query);
  }

  async searchConversationMessages(userId: string, conversationId: string, query: {
    q: string; limit?: number;
  }): Promise<{ results: { id: string; conversationId: string; userIdFrom: string; seq: number; excerpt: string; createdAt: Date }[] }> {
    return this.messages.searchConversationMessages(userId, conversationId, query);
  }

  async sendMessage(actorId: string, conversationId: string, input: { text: string; subject?: string; clientMessageId?: string; replyToMessageId?: string }): Promise<MessageWithQuoteRow> {
    return this.messages.sendMessage(actorId, conversationId, input);
  }

  async updateMessage(): Promise<never> {
    return this.messages.updateMessage();
  }

  async deleteMessage(actorId: string, messageId: string): Promise<MessageRow> {
    return this.messages.deleteMessage(actorId, messageId);
  }

  async recallMessage(actorId: string, messageId: string): Promise<MessageRow> {
    return this.messages.recallMessage(actorId, messageId);
  }

  async hardDeleteMessage(actorId: string, messageId: string, input: { reason: string }): Promise<{ deleted: true; messageId: string; conversationId: string }> {
    return this.messages.hardDeleteMessage(actorId, messageId, input);
  }

  async bulkRemoveMessages(actorId: string, input: { messageIds: string[]; reason: string }): Promise<{ removed: number; messageIds: string[] }> {
    return this.messages.bulkRemoveMessages(actorId, input);
  }

  async reportConversation(actorId: string, conversationId: string, reason?: string): Promise<ReportRow> {
    return this.messages.reportConversation(actorId, conversationId, reason);
  }

  async listReports(actorId: string): Promise<ReportRow[]> {
    return this.messages.listReports(actorId);
  }

  async getReportConversation(actorId: string, reportId: string): Promise<{
    report: ReportRow;
    conversation: ConversationRow & { members: string[]; messages: MessageRow[] };
  }> {
    return this.messages.getReportConversation(actorId, reportId);
  }

  async updateReportStatus(actorId: string, reportId: string, status: string): Promise<ReportRow> {
    return this.messages.updateReportStatus(actorId, reportId, status);
  }

  async markConversationRead(userId: string, conversationId: string): Promise<{ marked: number; lastReadSeq: number }> {
    return this.messages.markConversationRead(userId, conversationId);
  }

  async unreadCounts(userId: string): Promise<{ conversations: number; notifications: number }> {
    return this.messages.unreadCounts(userId);
  }
}
