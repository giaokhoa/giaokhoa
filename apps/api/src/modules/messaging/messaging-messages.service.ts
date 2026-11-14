import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OutboxService } from '../../infra/events/outbox.service';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { SiteConfigService } from '../site-config/site-config.service';
import { UsersService } from '../users/users.service';
import { MessagingRepository, type ConversationRow, type MessageRow, type MessageWithQuoteRow, type ReportRow } from '@giaokhoa/db/repositories/messaging';
import { blankRecalledContent, searchExcerptOf } from '@giaokhoa/messaging';
import { tenantAls } from '../tenants/tenant-als';
import { MessagingSendThrottleService } from './messaging-send-throttle.service';
import { MessagingContactsService } from './messaging-contacts.service';
import { MessagingConversationsService } from './messaging-conversations.service';
import { MessagingMembershipSyncService } from './messaging-membership-sync.service';
import { MessagingNotificationsService } from './messaging-notifications.service';

export function countUserVisibleCharacters(text: string): number {
  const SegmenterCtor = (Intl as unknown as {
    Segmenter?: new (locales?: string, options?: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<unknown>;
    };
  }).Segmenter;
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _segment of segmenter.segment(text)) count += 1;
    return count;
  }
  return [...text].length;
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function isWithinRecallWindow(createdAt: Date, now: Date, windowMinutes: number): boolean {
  if (windowMinutes <= 0) return false;
  return now.getTime() - createdAt.getTime() <= windowMinutes * 60_000;
}

export class MessagingMessagesService {
  constructor(
    private readonly repo: MessagingRepository,
    private readonly users: UsersService,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly outbox: OutboxService,
    private readonly siteConfig: SiteConfigService,
    private readonly sendThrottle: MessagingSendThrottleService,
    private readonly conversations: MessagingConversationsService,
    private readonly contacts: MessagingContactsService,
    private readonly notifications: MessagingNotificationsService,
    private readonly membershipSync: MessagingMembershipSyncService,
  ) {}

  async listConversationMessages(userId: string, conversationId: string, query: {
    beforeSeq?: number; afterSeq?: number; limit?: number;
  }): Promise<{ messages: MessageWithQuoteRow[]; hasMoreBefore: boolean }> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.conversations.assertConversationMember(userId, conversation);
    await this.conversations.assertDirectConversationVisible(userId, conversation);
    const canModerate = await this.conversations.canModerateConversation(userId, conversation);
    const rawMessages = await this.repo.listMessages(conversationId, {
      ...query,
      includeDeleted: canModerate,
      viewerId: canModerate ? undefined : userId,
    });
    const withQuotes = await this.repo.attachQuotes(rawMessages, {
      privileged: canModerate,
      viewerId: canModerate ? undefined : userId,
    });
    const messages = canModerate ? withQuotes : withQuotes.map((m) => ({ ...blankRecalledContent(m), replyTo: m.replyTo }));
    return {
      messages,
      hasMoreBefore: messages.length > 0 && query.afterSeq === undefined
        ? await this.repo.hasMessagesBefore(conversationId, messages[0]!.seq, canModerate, canModerate ? undefined : userId)
        : false,
    };
  }

  async searchConversationMessages(userId: string, conversationId: string, query: {
    q: string; limit?: number;
  }): Promise<{ results: { id: string; conversationId: string; userIdFrom: string; seq: number; excerpt: string; createdAt: Date }[] }> {
    const q = query.q.trim();
    if (q.length === 0) {
      throw new BadRequestException({ message: 'Search query must not be empty', code: 'messaging.search_query_empty' });
    }
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.conversations.assertConversationMember(userId, conversation);
    await this.conversations.assertDirectConversationVisible(userId, conversation);
    const canModerate = await this.conversations.canModerateConversation(userId, conversation);
    const rows = await this.repo.searchMessages(conversationId, {
      query: q,
      limit: query.limit,
      privileged: canModerate,
      viewerId: canModerate ? undefined : userId,
      excludedAuthorIds: canModerate ? undefined : await this.repo.listBlockedCounterpartIds(userId),
    });
    return {
      results: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        userIdFrom: row.userIdFrom,
        seq: row.seq,
        excerpt: searchExcerptOf(row.fullMessage, q),
        createdAt: row.createdAt,
      })),
    };
  }

  async sendMessage(actorId: string, conversationId: string, input: { text: string; subject?: string; clientMessageId?: string; replyToMessageId?: string }): Promise<MessageWithQuoteRow> {
    const systemCtx = await this.contexts.ensureSystemContext();
    const senderCtx = await this.contexts.getByLevelInstance(30, actorId);
    await this.evaluator.requireCapability(actorId, 'site:sendmessage', senderCtx?.id ?? systemCtx.id);
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.conversations.assertConversationMember(actorId, conversation);
    if (!conversation.enabled && !(await this.conversations.canManageConversation(actorId, conversation))) {
      throw new ForbiddenException({
        message: 'Chat is disabled for this conversation',
        code: 'messaging.conversation_disabled',
      });
    }
    const members = await this.repo.listMembers(conversationId);
    for (const memberId of members) {
      if (memberId === actorId) continue;
      const recipient = await this.users.getByIdOrUndefined(memberId);
      if (!recipient || recipient.suspended || recipient.deleted) {
        throw new ForbiddenException({ message: `User ${memberId} cannot receive messages (suspended)`, code: 'messaging.recipient_suspended' });
      }
      if (await this.repo.isBlocked(memberId, actorId)) {
        throw new ForbiddenException({ message: `User ${memberId} has blocked you`, code: 'messaging.contact_blocked' });
      }
    }
    if (conversation.type === 1) {
      const other = members.find((id) => id !== actorId);
      if (other) {
        if (await this.repo.isBlocked(actorId, other)) {
          throw new ForbiddenException({ message: 'You have blocked this user', code: 'messaging.contact_blocked' });
        }
        await this.contacts.assertCanContact(actorId, other);
      }
    }
    const withQuote = async (row: MessageRow): Promise<MessageWithQuoteRow> =>
      (await this.repo.attachQuotes([row], { privileged: false, viewerId: actorId }))[0]!;
    if (input.clientMessageId) {
      const existing = await this.repo.getMessageByClientId(conversationId, actorId, input.clientMessageId);
      if (existing) return withQuote(existing);
    }
    if (input.replyToMessageId) {
      const original = await this.repo.getMessage(input.replyToMessageId);
      if (!original || original.conversationId !== conversationId) {
        throw new BadRequestException({
          message: 'Quoted message not found in this conversation',
          code: 'messaging.reply_target_not_found',
        });
      }
    }
    await this.assertMessageLengthAllowed(input.text);
    await this.sendThrottle.consume(actorId);
    try {
      const saved = await this.repo.transaction(async (tx) => {
        const seq = await this.repo.allocateNextSeq(conversationId, tx);
        const msg = await this.repo.insertMessage({
          conversationId: conversationId, userIdFrom: actorId,
          subject: input.subject ?? '', fullMessage: input.text, smallMessage: input.text.slice(0, 200),
          seq, clientMessageId: input.clientMessageId ?? null,
          replyToMessageId: input.replyToMessageId ?? null,
        }, tx);
        await this.repo.clearArchivedForIncomingMessage(conversationId, actorId, tx);
        await this.outbox.enqueueKysely(tx, {
          aggregate: 'messaging', type: 'message_sent',
          payload: {
            conversationId, messageId: msg.id, seq, fromUserId: actorId,
            memberIds: members, clientMessageId: input.clientMessageId ?? null,
            replyToMessageId: input.replyToMessageId ?? null,
          },
        });
        return msg;
      });
      return await withQuote(saved);
    } catch (err) {
      if (input.clientMessageId && isUniqueViolation(err)) {
        const existing = await this.repo.getMessageByClientId(conversationId, actorId, input.clientMessageId);
        if (existing) return withQuote(existing);
      }
      throw err;
    }
  }

  async updateMessage(): Promise<never> {
    throw new ForbiddenException({
      message: 'A sent message cannot be modified: ownership passed to core_message when it was sent',
      code: 'messaging.message_immutable',
    });
  }


  private async assertMessageLengthAllowed(text: string): Promise<void> {
    const value = await this.siteConfig.getValue<number>('core', 'messagingmaxmessagelength');
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const max = Math.floor(value);
    if (max <= 0) return;
    const count = countUserVisibleCharacters(text);
    if (count > max) {
      throw new BadRequestException({
        message: `Message is too long: ${count} characters (maximum ${max})`,
        code: 'messaging.message_too_long',
      });
    }
  }

  private async recallWindowMinutes(): Promise<number> {
    const value = await this.siteConfig.getValue<number>('core', 'messagingrecallwindowminutes');
    if (typeof value !== 'number' || !Number.isFinite(value)) return 15;
    return Math.max(0, Math.floor(value));
  }

  private async assertCanHardDelete(actorId: string, conversation: ConversationRow): Promise<void> {
    const forbidden = () => new ForbiddenException({
      message: 'Only a moderator with the moderation:manage capability in this conversation scope can permanently remove messages',
      code: 'messaging.message_moderation_forbidden',
    });
    if (!(await this.conversations.canModerateConversation(actorId, conversation))) throw forbidden();
    const courseId = await this.conversations.resolveConversationCourseId(conversation);
    if (!courseId) {
      const classId = await this.conversations.resolveConversationClassId(conversation);
      if (classId) {
        const classCtx = await this.contexts.getByLevelInstance(45, classId);
        const allowedClass = classCtx
          ? await this.evaluator.hasCapability(actorId, 'moderation:manage', classCtx.id)
          : await this.evaluator.isSiteAdmin(actorId);
        if (!allowedClass) throw forbidden();
        return;
      }
      if (!(await this.evaluator.isSiteAdmin(actorId))) throw forbidden();
      return;
    }
    const courseCtx = await this.contexts.getByLevelInstance(50, courseId);
    const allowed = courseCtx
      ? await this.evaluator.hasCapability(actorId, 'moderation:manage', courseCtx.id)
      : await this.evaluator.isSiteAdmin(actorId);
    if (!allowed) throw forbidden();
  }

  async deleteMessage(actorId: string, messageId: string): Promise<MessageRow> {
    const existing = await this.repo.getMessage(messageId);
    if (!existing) throw new NotFoundException({ message: `Message ${messageId} not found`, code: 'messaging.message_not_found' });
    const conversation = await this.repo.getConversation(existing.conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${existing.conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.conversations.assertDirectConversationVisible(actorId, conversation);
    if (existing.userIdFrom !== actorId) {
      throw new ForbiddenException({
        message: 'Only the author can delete this message for themselves; permanent removal belongs to moderators',
        code: 'messaging.message_delete_forbidden',
      });
    }
    if (existing.deletedAt) return existing;
    if (!(await this.repo.isDeletedForUser(messageId, actorId))) {
      await this.repo.markDeletedForUser(messageId, actorId);
      const courseId = await this.conversations.resolveConversationCourseId(conversation);
      await this.outbox.enqueueStandalone({
        aggregate: 'messaging', type: 'message_deleted_for_me',
        payload: {
          actorId, conversationId: conversation.id, messageId, seq: existing.seq,
          authorId: existing.userIdFrom, courseId: courseId ?? undefined,
        },
      });
    }
    return existing;
  }

  async recallMessage(actorId: string, messageId: string): Promise<MessageRow> {
    const existing = await this.repo.getMessage(messageId);
    if (!existing) throw new NotFoundException({ message: `Message ${messageId} not found`, code: 'messaging.message_not_found' });
    const conversation = await this.repo.getConversation(existing.conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${existing.conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.conversations.assertDirectConversationVisible(actorId, conversation);
    if (existing.userIdFrom !== actorId) {
      throw new ForbiddenException({
        message: 'Only the author can recall this message',
        code: 'messaging.message_recall_forbidden',
      });
    }
    if (existing.recalledAt) return existing;
    if (existing.deletedAt) {
      throw new BadRequestException({
        message: 'This message is already deleted and can no longer be recalled',
        code: 'messaging.message_already_deleted',
      });
    }
    const windowMinutes = await this.recallWindowMinutes();
    if (!isWithinRecallWindow(existing.createdAt, new Date(), windowMinutes)) {
      throw new ForbiddenException({
        message: `The recall window of ${windowMinutes} minutes has expired for this message`,
        code: 'messaging.recall_window_expired',
      });
    }
    await this.repo.insertModeratorAction({
      messageId, conversationId: conversation.id, actorId, authorId: existing.userIdFrom,
      action: 'recall', reason: null, messageSeq: existing.seq,
    });
    const recalled = await this.repo.applyRecall(messageId, actorId);
    const courseId = await this.conversations.resolveConversationCourseId(conversation);
    await this.outbox.enqueueStandalone({
      aggregate: 'messaging', type: 'message_recalled',
      payload: {
        actorId, conversationId: conversation.id, messageId, seq: existing.seq,
        recalledBy: actorId, authorId: existing.userIdFrom, courseId: courseId ?? undefined,
      },
    });
    return recalled!;
  }

  async hardDeleteMessage(actorId: string, messageId: string, input: { reason: string }): Promise<{ deleted: true; messageId: string; conversationId: string }> {
    const existing = await this.repo.getMessage(messageId);
    if (!existing) throw new NotFoundException({ message: `Message ${messageId} not found`, code: 'messaging.message_not_found' });
    const conversation = await this.repo.getConversation(existing.conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${existing.conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.assertCanHardDelete(actorId, conversation);
    await this.repo.insertModeratorAction({
      messageId, conversationId: conversation.id, actorId, authorId: existing.userIdFrom,
      action: 'hard_delete', reason: input.reason, messageSeq: existing.seq,
    });
    await this.repo.hardDeleteMessage(messageId);
    const courseId = await this.conversations.resolveConversationCourseId(conversation);
    await this.outbox.enqueueStandalone({
      aggregate: 'messaging', type: 'message_removed',
      payload: {
        actorId, conversationId: conversation.id, messageId, seq: existing.seq,
        removedBy: actorId, authorId: existing.userIdFrom, courseId: courseId ?? undefined,
      },
    });
    return { deleted: true, messageId, conversationId: conversation.id };
  }

  async bulkRemoveMessages(actorId: string, input: { messageIds: string[]; reason: string }): Promise<{ removed: number; messageIds: string[] }> {
    const uniqueIds = [...new Set(input.messageIds)];
    const rows = await this.repo.getMessagesByIds(uniqueIds);
    if (rows.length !== uniqueIds.length) {
      throw new NotFoundException({ message: 'One or more messages were not found', code: 'messaging.message_not_found' });
    }
    const conversations = new Map<string, ConversationRow>();
    for (const row of rows) {
      let conversation = conversations.get(row.conversationId);
      if (!conversation) {
        conversation = (await this.repo.getConversation(row.conversationId)) ?? undefined;
        if (!conversation) throw new NotFoundException({ message: `Conversation ${row.conversationId} not found`, code: 'messaging.conversation_not_found' });
        await this.membershipSync.syncGroupConversationIfLinked(conversation);
        conversations.set(row.conversationId, conversation);
      }
      await this.assertCanHardDelete(actorId, conversation);
    }
    for (const row of rows) {
      await this.repo.insertModeratorAction({
        messageId: row.id, conversationId: row.conversationId, actorId, authorId: row.userIdFrom,
        action: 'bulk_hard_delete', reason: input.reason, messageSeq: row.seq,
      });
    }
    for (const row of rows) {
      await this.repo.hardDeleteMessage(row.id);
    }
    for (const row of rows) {
      const conversation = conversations.get(row.conversationId)!;
      const courseId = await this.conversations.resolveConversationCourseId(conversation);
      await this.outbox.enqueueStandalone({
        aggregate: 'messaging', type: 'message_removed',
        payload: {
          actorId, conversationId: row.conversationId, messageId: row.id, seq: row.seq,
          removedBy: actorId, authorId: row.userIdFrom, bulk: true, courseId: courseId ?? undefined,
        },
      });
    }
    return { removed: rows.length, messageIds: rows.map((row) => row.id) };
  }


  async reportConversation(actorId: string, conversationId: string, reason?: string): Promise<ReportRow> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${conversationId} not found`, code: 'messaging.conversation_not_found' });
    await this.membershipSync.syncGroupConversationIfLinked(conversation);
    await this.conversations.assertConversationMember(actorId, conversation);
    const report = await this.repo.insertReport({
      conversationId, reporterId: actorId, reason: (reason ?? '').trim(),
    });
    const courseId = await this.conversations.resolveConversationCourseId(conversation);
    await this.outbox.enqueueStandalone({
      aggregate: 'messaging', type: 'message_conversation_reported',
      payload: { actorId, conversationId, reportId: report.id, courseId: courseId ?? undefined },
    });
    const recipients = new Set<string>(await this.evaluator.listSiteAdmins());
    if (courseId) {
      for (const staffId of await this.repo.listCourseStaffUserIds(courseId)) recipients.add(staffId);
    }
    recipients.delete(actorId);
    for (const recipientId of recipients) {
      await this.notifications.notify(recipientId, 'conversation_reported', {
        subject: 'A conversation was reported',
        body: 'A conversation was reported and is waiting in the moderation queue. Open the reports list in Messages to review it.',
        fromUserId: actorId,
        courseId: courseId ?? undefined,
        eventId: `conversation-report-${report.id}`,
      }).catch(() => undefined);
    }
    return report;
  }

  async listReports(actorId: string): Promise<ReportRow[]> {
    const reports = await this.repo.listReports();
    const admin = await this.evaluator.isSiteAdmin(actorId);
    if (admin) return reports;
    const cache = new Map<string, boolean>();
    const out: ReportRow[] = [];
    for (const report of reports) {
      let allowed = cache.get(report.conversationId);
      if (allowed === undefined) {
        const conversation = await this.repo.getConversation(report.conversationId);
        allowed = conversation ? await this.conversations.canModerateConversation(actorId, conversation) : false;
        cache.set(report.conversationId, allowed);
      }
      if (allowed) out.push(report);
    }
    return out;
  }

  async getReportConversation(actorId: string, reportId: string): Promise<{
    report: ReportRow;
    conversation: ConversationRow & { members: string[]; messages: MessageRow[] };
  }> {
    const report = await this.repo.getReport(reportId);
    if (!report) throw new NotFoundException({ message: `Report ${reportId} not found`, code: 'messaging.report_not_found' });
    const conversation = await this.repo.getConversation(report.conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${report.conversationId} not found`, code: 'messaging.conversation_not_found' });
    if (!(await this.conversations.canModerateConversation(actorId, conversation))) {
      throw new ForbiddenException({
        message: 'Only an administrator or the teacher in charge of this conversation\'s course can review a reported conversation',
        code: 'messaging.report_review_forbidden',
      });
    }
    const courseId = await this.conversations.resolveConversationCourseId(conversation);
    await this.outbox.enqueueStandalone({
      aggregate: 'messaging', type: 'message_conversation_report_viewed',
      payload: { actorId, conversationId: conversation.id, reportId: report.id, courseId: courseId ?? undefined },
    });
    const messages = await this.repo.listMessages(conversation.id, { limit: 100, includeDeleted: true });
    return {
      report,
      conversation: {
        ...conversation,
        members: await this.repo.listMembers(conversation.id),
        messages,
      },
    };
  }

  async updateReportStatus(actorId: string, reportId: string, status: string): Promise<ReportRow> {
    const report = await this.repo.getReport(reportId);
    if (!report) throw new NotFoundException({ message: `Report ${reportId} not found`, code: 'messaging.report_not_found' });
    const conversation = await this.repo.getConversation(report.conversationId);
    if (!conversation) throw new NotFoundException({ message: `Conversation ${report.conversationId} not found`, code: 'messaging.conversation_not_found' });
    if (!(await this.conversations.canModerateConversation(actorId, conversation))) {
      throw new ForbiddenException({
        message: 'Only an administrator or the teacher in charge of this conversation\'s course can handle its reports',
        code: 'messaging.report_review_forbidden',
      });
    }
    const updated = await this.repo.updateReportStatus(reportId, status, actorId);
    return updated!;
  }

  async markConversationRead(userId: string, conversationId: string): Promise<{ marked: number; lastReadSeq: number }> {
    const conversation = await this.repo.getConversation(conversationId);
    if (conversation) {
      await this.conversations.assertConversationMember(userId, conversation);
      await this.conversations.assertDirectConversationVisible(userId, conversation);
    } else if (!(await this.repo.isMember(conversationId, userId))) {
      throw new ForbiddenException({ message: 'You are not a member of this conversation', code: 'messaging.not_member' });
    }
    const before = (await this.repo.getMemberLastReadSeq(conversationId, userId)) ?? 0;
    const result = await this.repo.markConversationRead(conversationId, userId);
    if (result.lastReadSeq > before) {
      await this.outbox.enqueueStandalone({
        aggregate: 'messaging', type: 'message_conversation_read',
        payload: { conversationId, userId, lastReadSeq: result.lastReadSeq },
      });
    }
    return result;
  }

  async unreadCounts(userId: string): Promise<{ conversations: number; notifications: number }> {
    return {
      conversations: await this.repo.countUnreadConversations(userId),
      notifications: await this.repo.countUnreadNotifications(userId, tenantAls.getStore()?.tenantId),
    };
  }
}
