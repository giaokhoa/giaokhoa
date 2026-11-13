import { io, type Socket } from 'socket.io-client';
import {
  MESSAGING_SOCKET_EVENTS,
  type MessagingSyncRequest,
  type MessagingSyncResult,
  type RealtimeConversationInvalidatePayload,
  type RealtimeConversationUpdatedPayload,
  type RealtimeMessageDeletedPayload,
  type RealtimeMessageReadPayload,
  type RealtimeNewMessagePayload,
  type RealtimePresencePayload,
  type RealtimePresenceSnapshotPayload,
  type RealtimeTypingPayload,
} from '@giaokhoa/contracts';

export interface MessagingRealtimeHandlers {
  onNewMessage(payload: RealtimeNewMessagePayload): void;
  onConversationUpdated(payload: RealtimeConversationUpdatedPayload): void;
  onReadReceipt(payload: RealtimeMessageReadPayload): void;
  onMessageDeleted(payload: RealtimeMessageDeletedPayload): void;
  onConversationInvalidate(payload: RealtimeConversationInvalidatePayload): void;
  onTyping(payload: RealtimeTypingPayload): void;
  onPresence(payload: RealtimePresencePayload): void;
  onPresenceSnapshot(payload: RealtimePresenceSnapshotPayload): void;
  onReconnect(): void;
}

export interface MessagingRealtimeHandle {
  sync(lastSeqByConversation: MessagingSyncRequest): Promise<MessagingSyncResult>;
  joinConversation(conversationId: string): void;
  typing(conversationId: string): void;
  disconnect(): void;
}

export function connectMessagingRealtime(handlers: MessagingRealtimeHandlers): MessagingRealtimeHandle {
  const socket: Socket = io('/messaging', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  let connectedOnce = false;
  socket.on('connect', () => {
    if (connectedOnce) handlers.onReconnect();
    connectedOnce = true;
  });
  socket.on(MESSAGING_SOCKET_EVENTS.newMessage, (payload: RealtimeNewMessagePayload) => handlers.onNewMessage(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.conversationUpdated, (payload: RealtimeConversationUpdatedPayload) => handlers.onConversationUpdated(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.messageRead, (payload: RealtimeMessageReadPayload) => handlers.onReadReceipt(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.messageDeleted, (payload: RealtimeMessageDeletedPayload) => handlers.onMessageDeleted(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.conversationInvalidate, (payload: RealtimeConversationInvalidatePayload) => handlers.onConversationInvalidate(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.typing, (payload: RealtimeTypingPayload) => handlers.onTyping(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.presenceChanged, (payload: RealtimePresencePayload) => handlers.onPresence(payload));
  socket.on(MESSAGING_SOCKET_EVENTS.presenceSnapshot, (payload: RealtimePresenceSnapshotPayload) => handlers.onPresenceSnapshot(payload));

  return {
    async sync(lastSeqByConversation: MessagingSyncRequest): Promise<MessagingSyncResult> {
      if (!socket.connected) return {};
      try {
        return (await socket.emitWithAck(MESSAGING_SOCKET_EVENTS.sync, lastSeqByConversation)) as MessagingSyncResult;
      } catch {
        return {};
      }
    },
    joinConversation(conversationId: string): void {
      if (socket.connected) void socket.emitWithAck(MESSAGING_SOCKET_EVENTS.joinConversation, { conversationId }).catch(() => undefined);
    },
    typing(conversationId: string): void {
      if (socket.connected) void socket.emitWithAck(MESSAGING_SOCKET_EVENTS.typing, { conversationId }).catch(() => undefined);
    },
    disconnect(): void {
      socket.disconnect();
    },
  };
}
