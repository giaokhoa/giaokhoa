import {
  MESSAGING_SOCKET_EVENTS,
  type RealtimeConversationInvalidatePayload,
  type RealtimeConversationUpdatedPayload,
  type RealtimeMessageDeletedPayload,
  type RealtimeMessageReadPayload,
  type RealtimeNewMessagePayload,
} from '@giaokhoa/contracts';
import { blankRecalledContent, toWireMessage, type MessageRow } from './message-wire.js';
import { conversationRoom, userRoom } from './realtime-rooms.js';
import type { MessagingDistributionStore } from './distribution-store.js';

export const MESSAGING_DISTRIBUTED_EVENT_TYPES = [
  'message_sent',
  'message_conversation_read',
  'message_deleted',
  'message_recalled',
  'message_removed',
  'message_deleted_for_me',
] as const;

export interface RealtimeRemoteSocket {
  data: { userId?: unknown };
  leave(room: string): Promise<unknown> | unknown;
}

export interface RealtimeEmitter {
  emitToRoom(room: string, event: string, payload: unknown): Promise<void> | void;
  fetchSocketsInRoom(room: string): Promise<RealtimeRemoteSocket[]>;
}

export interface MessagingDistributionLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface MessagingDistributionService {
  distributeEvent(type: string, payload: Record<string, unknown>): Promise<void>;
  distributeNewMessage(messageRow: MessageRow, memberIds: string[]): Promise<void>;
  distributeMessageDeleted(messageRow: MessageRow, memberIds: string[]): Promise<void>;
  distributeMessageRecalled(messageRow: MessageRow, memberIds: string[]): Promise<void>;
  distributeMessageRemoved(
    snapshot: { conversationId: string; messageId: string; seq: number; removedBy: string },
    memberIds: string[],
  ): Promise<void>;
  distributeMessageDeletedForMe(
    snapshot: { conversationId: string; messageId: string; seq: number; actorId: string },
  ): Promise<void>;
  distributeReadReceipt(payload: RealtimeMessageReadPayload): Promise<void>;
}

export function createMessagingDistributionService(deps: {
  store: MessagingDistributionStore;
  emitter: RealtimeEmitter;
  logger: MessagingDistributionLogger;
  spaceId?: () => string | null | undefined;
}): MessagingDistributionService {
  const { store, emitter, logger } = deps;
  const currentSpaceId = () => deps.spaceId?.() ?? null;

  async function tenantIdOfConversation(conversationId: string): Promise<string | null> {
    return store.getConversationTenantId(conversationId).catch(() => null);
  }

  async function blockedCounterpartIdsFailClosed(userId: string): Promise<string[] | null> {
    try {
      return await store.listBlockedCounterpartIds(userId);
    } catch (error) {
      logger.error(
        `Không tra được danh sách chặn của user ${userId}, nén phân phối realtime theo kỷ luật fail-closed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async function evictNonMemberSockets(tenantId: string | null, conversationId: string, memberIds: string[]): Promise<void> {
    try {
      const memberSet = new Set(memberIds);
      const room = conversationRoom(tenantId, conversationId, currentSpaceId());
      const sockets = await emitter.fetchSocketsInRoom(room);
      await Promise.all(sockets
        .filter((socket) => {
          const userId = socket.data?.userId;
          return typeof userId !== 'string' || !memberSet.has(userId);
        })
        .map((socket) => socket.leave(room)));
    } catch (error) {
      logger.warn(`Không rà soát được room của conversation ${conversationId}: ${(error as Error).message}`);
    }
  }

  async function suppressIfBlockedDirectPair(conversationId: string, memberIds: string[]): Promise<boolean> {
    const conversation = await store.getConversation(conversationId).catch(() => undefined);
    if (conversation?.type !== 1 || memberIds.length !== 2) return false;
    const first = memberIds[0];
    const second = memberIds[1];
    if (first === undefined || second === undefined) return true;
    const blocked = await blockedCounterpartIdsFailClosed(first);
    if (blocked === null) return true;
    if (!blocked.includes(second)) return false;
    return true;
  }

  async function emitConversationInvalidate(tenantId: string | null, conversationId: string, memberIds: string[]): Promise<void> {
    const payload: RealtimeConversationInvalidatePayload = { conversationId };
    await Promise.all(memberIds.map((memberId) => emitter.emitToRoom(userRoom(tenantId, memberId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.conversationInvalidate, payload)));
  }

  async function distributeNewMessage(messageRow: MessageRow, memberIds: string[]): Promise<void> {
    const conversation = await store.getConversation(messageRow.conversationId).catch(() => undefined);
    if (conversation?.type === 1 && memberIds.length === 2) {
      const first = memberIds[0];
      const second = memberIds[1];
      if (first === undefined || second === undefined) return;
      const blocked = await blockedCounterpartIdsFailClosed(first);
      if (blocked === null || blocked.includes(second)) {
        return;
      }
    }
    const tenantId = conversation?.tenantId ?? null;
    const [withQuote] = await store.attachQuotes([messageRow], { privileged: false });
    const wire = toWireMessage(messageRow, withQuote?.replyTo ?? null);
    const newPayload: RealtimeNewMessagePayload = { conversationId: messageRow.conversationId, message: wire };
    await evictNonMemberSockets(tenantId, messageRow.conversationId, memberIds);
    await emitter.emitToRoom(conversationRoom(tenantId, messageRow.conversationId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.newMessage, newPayload);
    await Promise.all(memberIds.map(async (memberId) => {
      const unreadCount = await store.countUnreadForConversation(messageRow.conversationId, memberId).catch(() => 0);
      const payload: RealtimeConversationUpdatedPayload = {
        conversationId: messageRow.conversationId, message: wire, unreadCount,
      };
      await emitter.emitToRoom(userRoom(tenantId, memberId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.conversationUpdated, payload);
    }));
  }

  async function distributeMessageDeleted(messageRow: MessageRow, memberIds: string[]): Promise<void> {
    const conversation = await store.getConversation(messageRow.conversationId).catch(() => undefined);
    if (conversation?.type === 1 && memberIds.length === 2) {
      const first = memberIds[0];
      const second = memberIds[1];
      if (first === undefined || second === undefined) return;
      const blocked = await blockedCounterpartIdsFailClosed(first);
      if (blocked === null || blocked.includes(second)) {
        return;
      }
    }
    const tenantId = conversation?.tenantId ?? null;
    await evictNonMemberSockets(tenantId, messageRow.conversationId, memberIds);
    const deletedPayload: RealtimeMessageDeletedPayload = {
      conversationId: messageRow.conversationId,
      messageId: messageRow.id,
      seq: messageRow.seq,
      deletedBy: messageRow.deletedBy ?? '',
    };
    await emitter.emitToRoom(conversationRoom(tenantId, messageRow.conversationId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.messageDeleted, deletedPayload);
    const [lastVisible] = await store.listMessages(messageRow.conversationId, { limit: 1 }).catch(() => []);
    if (!lastVisible) return;
    const wire = toWireMessage(lastVisible);
    await Promise.all(memberIds.map(async (memberId) => {
      const unreadCount = await store.countUnreadForConversation(messageRow.conversationId, memberId).catch(() => 0);
      const payload: RealtimeConversationUpdatedPayload = {
        conversationId: messageRow.conversationId, message: wire, unreadCount,
      };
      await emitter.emitToRoom(userRoom(tenantId, memberId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.conversationUpdated, payload);
    }));
  }

  async function distributeMessageRecalled(messageRow: MessageRow, memberIds: string[]): Promise<void> {
    if (await suppressIfBlockedDirectPair(messageRow.conversationId, memberIds)) return;
    const tenantId = await tenantIdOfConversation(messageRow.conversationId);
    await evictNonMemberSockets(tenantId, messageRow.conversationId, memberIds);
    const deletedPayload: RealtimeMessageDeletedPayload = {
      conversationId: messageRow.conversationId,
      messageId: messageRow.id,
      seq: messageRow.seq,
      deletedBy: messageRow.recalledBy ?? '',
    };
    await emitter.emitToRoom(conversationRoom(tenantId, messageRow.conversationId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.messageDeleted, deletedPayload);
    const [lastVisible] = await store.listMessages(messageRow.conversationId, { limit: 1 }).catch(() => []);
    if (lastVisible) {
      const wire = toWireMessage(blankRecalledContent(lastVisible));
      await Promise.all(memberIds.map(async (memberId) => {
        const unreadCount = await store.countUnreadForConversation(messageRow.conversationId, memberId).catch(() => 0);
        const payload: RealtimeConversationUpdatedPayload = {
          conversationId: messageRow.conversationId, message: wire, unreadCount,
        };
        await emitter.emitToRoom(userRoom(tenantId, memberId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.conversationUpdated, payload);
      }));
    }
    await emitConversationInvalidate(tenantId, messageRow.conversationId, memberIds);
  }

  async function distributeMessageRemoved(
    snapshot: { conversationId: string; messageId: string; seq: number; removedBy: string },
    memberIds: string[],
  ): Promise<void> {
    if (await suppressIfBlockedDirectPair(snapshot.conversationId, memberIds)) return;
    const tenantId = await tenantIdOfConversation(snapshot.conversationId);
    await evictNonMemberSockets(tenantId, snapshot.conversationId, memberIds);
    const deletedPayload: RealtimeMessageDeletedPayload = {
      conversationId: snapshot.conversationId,
      messageId: snapshot.messageId,
      seq: snapshot.seq,
      deletedBy: snapshot.removedBy,
    };
    await emitter.emitToRoom(conversationRoom(tenantId, snapshot.conversationId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.messageDeleted, deletedPayload);
    const [lastVisible] = await store.listMessages(snapshot.conversationId, { limit: 1 }).catch(() => []);
    if (lastVisible) {
      const wire = toWireMessage(blankRecalledContent(lastVisible));
      await Promise.all(memberIds.map(async (memberId) => {
        const unreadCount = await store.countUnreadForConversation(snapshot.conversationId, memberId).catch(() => 0);
        const payload: RealtimeConversationUpdatedPayload = {
          conversationId: snapshot.conversationId, message: wire, unreadCount,
        };
        await emitter.emitToRoom(userRoom(tenantId, memberId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.conversationUpdated, payload);
      }));
    }
    await emitConversationInvalidate(tenantId, snapshot.conversationId, memberIds);
  }

  async function distributeMessageDeletedForMe(snapshot: { conversationId: string; messageId: string; seq: number; actorId: string }): Promise<void> {
    const tenantId = await tenantIdOfConversation(snapshot.conversationId);
    const deletedPayload: RealtimeMessageDeletedPayload = {
      conversationId: snapshot.conversationId,
      messageId: snapshot.messageId,
      seq: snapshot.seq,
      deletedBy: snapshot.actorId,
    };
    await emitter.emitToRoom(userRoom(tenantId, snapshot.actorId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.messageDeleted, deletedPayload);
    const invalidatePayload: RealtimeConversationInvalidatePayload = { conversationId: snapshot.conversationId };
    await emitter.emitToRoom(userRoom(tenantId, snapshot.actorId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.conversationInvalidate, invalidatePayload);
  }

  async function distributeReadReceipt(payload: RealtimeMessageReadPayload): Promise<void> {
    const conversation = await store.getConversation(payload.conversationId).catch(() => undefined);
    const memberIds = await store.listMembers(payload.conversationId).catch(() => null);
    if (conversation?.type === 1 && memberIds?.length === 2) {
      const other = memberIds.find((id) => id !== payload.userId);
      if (other) {
        const blocked = await blockedCounterpartIdsFailClosed(payload.userId);
        if (blocked === null || blocked.includes(other)) {
          return;
        }
      }
    }
    const tenantId = conversation?.tenantId ?? null;
    if (memberIds) await evictNonMemberSockets(tenantId, payload.conversationId, memberIds);
    await emitter.emitToRoom(conversationRoom(tenantId, payload.conversationId, currentSpaceId()), MESSAGING_SOCKET_EVENTS.messageRead, payload);
  }

  async function distributeEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    if (type === 'message_sent') {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
      if (!messageId) return;
      const message = await store.getMessage(messageId);
      if (!message) return;
      const memberIds = await store.listMembers(message.conversationId);
      if (message.recalledAt) {
        await distributeMessageRecalled(message, memberIds);
        return;
      }
      await distributeNewMessage(message, memberIds);
      return;
    }
    if (type === 'message_conversation_read') {
      const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
      const userId = typeof payload.userId === 'string' ? payload.userId : null;
      const lastReadSeq = typeof payload.lastReadSeq === 'number' ? payload.lastReadSeq : null;
      if (!conversationId || !userId || lastReadSeq === null) return;
      await distributeReadReceipt({ conversationId, userId, lastReadSeq });
      return;
    }
    if (type === 'message_deleted') {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
      if (!messageId) return;
      const message = await store.getMessage(messageId);
      if (!message || !message.deletedAt) return;
      const memberIds = await store.listMembers(message.conversationId);
      await distributeMessageDeleted(message, memberIds);
      return;
    }
    if (type === 'message_recalled') {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
      if (!messageId) return;
      const message = await store.getMessage(messageId);
      if (!message || !message.recalledAt) return;
      const memberIds = await store.listMembers(message.conversationId);
      await distributeMessageRecalled(message, memberIds);
      return;
    }
    if (type === 'message_removed') {
      const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
      const seq = typeof payload.seq === 'number' ? payload.seq : null;
      const removedBy = typeof payload.removedBy === 'string' ? payload.removedBy : null;
      if (!conversationId || !messageId || seq === null || !removedBy) return;
      const memberIds = await store.listMembers(conversationId);
      await distributeMessageRemoved({ conversationId, messageId, seq, removedBy }, memberIds);
      return;
    }
    if (type === 'message_deleted_for_me') {
      const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
      const seq = typeof payload.seq === 'number' ? payload.seq : null;
      const actorId = typeof payload.actorId === 'string' ? payload.actorId : null;
      if (!conversationId || !messageId || seq === null || !actorId) return;
      await distributeMessageDeletedForMe({ conversationId, messageId, seq, actorId });
    }
  }

  return {
    distributeEvent,
    distributeNewMessage,
    distributeMessageDeleted,
    distributeMessageRecalled,
    distributeMessageRemoved,
    distributeMessageDeletedForMe,
    distributeReadReceipt,
  };
}
