import { useEffect } from 'react';
import { connectMessagingRealtime, type MessagingRealtimeHandle } from '../api/messaging-socket';
import { withConversationMovedToSectionTop, withTreeUnread } from '../utils/page-helpers';
import type { ConversationGroupTreeView, ConversationView, MessageView } from '../types/types';

export interface UseMessagesRealtimeParams {
  myId: string | undefined;
  markRead: (conversationId: string) => Promise<void>;
  recountUnread: () => void;
  reload: () => Promise<void>;
  activeRef: { current: ConversationView | null };
  lastSeqRef: { current: Map<string, number> };
  mergeServerMessages: (conversationId: string, messages: MessageView[]) => void;
  patchMessages: (conversationId: string, updater: (messages: MessageView[]) => MessageView[]) => void;
  applyReadMarker: (conversationId: string, userId: string, lastReadSeq: number) => void;
  invalidateConversationWindow: (conversationId: string) => void;
  setConversations: (conversations: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => void;
  setArchivedConversations: (conversations: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => void;
  setGroupTree: (
    tree:
      ConversationGroupTreeView | null | ((prev: ConversationGroupTreeView | null) => ConversationGroupTreeView | null),
  ) => void;
  setTypingUsers: (
    users: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  setOnlineUsers: (
    users: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  realtimeRef: { current: MessagingRealtimeHandle | null };
  suspendRealtime?: boolean;
}

export function useMessagesRealtime({
  myId,
  markRead,
  recountUnread,
  reload,
  activeRef,
  lastSeqRef,
  mergeServerMessages,
  patchMessages,
  applyReadMarker,
  invalidateConversationWindow,
  setConversations,
  setArchivedConversations,
  setGroupTree,
  setTypingUsers,
  setOnlineUsers,
  realtimeRef,
  suspendRealtime,
}: UseMessagesRealtimeParams) {
  useEffect(() => {
    if (!myId || suspendRealtime) return;
    const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    let presenceLiveUsers = new Set<string>();
    const noteSeq = (conversationId: string, seq: number) => {
      const seen = lastSeqRef.current.get(conversationId) ?? 0;
      if (seq > seen) lastSeqRef.current.set(conversationId, seq);
    };
    const handle = connectMessagingRealtime({
      onNewMessage: ({ conversationId, message }) => {
        noteSeq(conversationId, message.seq);
        mergeServerMessages(conversationId, [message]);
        if (activeRef.current?.id === conversationId) {
          if (message.userIdFrom !== myId) void markRead(conversationId);
        }
      },
      onConversationUpdated: ({ conversationId, message, unreadCount }) => {
        if (message.seq < (lastSeqRef.current.get(conversationId) ?? 0)) return;
        noteSeq(conversationId, message.seq);
        const applyUpdate = (c: ConversationView): ConversationView => ({
          ...c,
          unread: activeRef.current?.id === conversationId ? 0 : unreadCount,
          lastMessage: message,
          lastMessageSeq: message.seq,
        });
        let moved: ConversationView | undefined;
        setArchivedConversations((prev) => {
          const target = prev.find((c) => c.id === conversationId);
          if (!target) return prev;
          if (message.userIdFrom === myId) {
            return withConversationMovedToSectionTop(prev, conversationId, applyUpdate);
          }
          moved = target;
          return prev.filter((c) => c.id !== conversationId);
        });
        setConversations((prev) => {
          const target = prev.find((c) => c.id === conversationId);
          if (!target) {
            return moved ? [{ ...applyUpdate(moved), archivedAt: null }, ...prev] : prev;
          }
          return [applyUpdate(target), ...prev.filter((c) => c.id !== conversationId)];
        });
        recountUnread();
        setGroupTree((prev) =>
          withTreeUnread(prev, conversationId, activeRef.current?.id === conversationId ? 0 : unreadCount),
        );
      },
      onMessageDeleted: ({ conversationId, messageId, deletedBy }) => {
        patchMessages(conversationId, (prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), deletedBy } : m)),
        );
      },
      onConversationInvalidate: ({ conversationId }) => {
        if (activeRef.current?.id === conversationId) {
          invalidateConversationWindow(conversationId);
        }
        void reload().catch(() => undefined);
      },
      onReadReceipt: ({ conversationId, userId, lastReadSeq }) => {
        if (activeRef.current?.id === conversationId) {
          applyReadMarker(conversationId, userId, lastReadSeq);
        }
      },
      onTyping: ({ conversationId, userId }) => {
        if (activeRef.current?.id !== conversationId || userId === myId) return;
        setTypingUsers((prev) => ({ ...prev, [userId]: true }));
        const timeouts = typingTimeouts;
        const existing = timeouts.get(userId);
        if (existing) clearTimeout(existing);
        timeouts.set(
          userId,
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = { ...prev };
              delete next[userId];
              return next;
            });
          }, 4500),
        );
      },
      onPresence: ({ userId, online }) => {
        presenceLiveUsers.add(userId);
        setOnlineUsers((prev) => ({ ...prev, [userId]: online }));
      },
      onPresenceSnapshot: ({ onlineUserIds }) => {
        const liveUsers = presenceLiveUsers;
        presenceLiveUsers = new Set();
        if (!onlineUserIds.length) return;
        setOnlineUsers((prev) => {
          const next = { ...prev };
          for (const userId of onlineUserIds) {
            if (liveUsers.has(userId)) continue;
            next[userId] = true;
          }
          return next;
        });
      },
      onReconnect: () => {
        presenceLiveUsers = new Set();
        void reload().catch(() => undefined);
        const current = activeRef.current;
        if (current) {
          const lastSeq = lastSeqRef.current.get(current.id) ?? 0;
          void handle.sync({ [current.id]: lastSeq }).then((missing) => {
            const missed = missing[current.id];
            if (missed && missed.length) {
              for (const m of missed) noteSeq(current.id, m.seq);
              mergeServerMessages(current.id, missed);
            }
          });
        }
      },
    });
    realtimeRef.current = handle;
    return () => {
      handle.disconnect();
      realtimeRef.current = null;
      for (const timeout of typingTimeouts.values()) clearTimeout(timeout);
      typingTimeouts.clear();
    };
  }, [
    myId,
    markRead,
    recountUnread,
    reload,
    mergeServerMessages,
    patchMessages,
    applyReadMarker,
    invalidateConversationWindow,
    setConversations,
    setArchivedConversations,
    setGroupTree,
    setTypingUsers,
    setOnlineUsers,
    activeRef,
    lastSeqRef,
    realtimeRef,
    suspendRealtime,
  ]);
}
