import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { conversationDetailQueryOptions } from '../queries/messaging';
import { readStoredConversationId } from '../utils/page-helpers';
import type { ConversationView } from '../types/types';

export interface UseConversationRestoreParams {
  deepLinkId: string | null;
  listLoaded: boolean;
  conversations: ConversationView[];
  setConversations: (conversations: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => void;
  open: (conv: ConversationView) => Promise<void> | void;
  sidebarTab: string;
}

export function useConversationRestore({
  deepLinkId,
  listLoaded,
  conversations,
  setConversations,
  open,
  sidebarTab,
}: UseConversationRestoreParams) {
  const queryClient = useQueryClient();
  const deepLinkHandledRef = useRef(false);
  const contextRestoredRef = useRef(false);

  useEffect(() => {
    if (!deepLinkId || !listLoaded || deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;
    const found = conversations.find((c) => c.id === deepLinkId);
    if (found) {
      void open(found);
      return;
    }
    void (async () => {
      try {
        const detail = await queryClient.fetchQuery(conversationDetailQueryOptions(deepLinkId));
        const summary: ConversationView = {
          id: detail.id,
          type: detail.type,
          name: detail.name,
          members: detail.members,
          unread: detail.unread,
          lastReadSeq: detail.lastReadSeq,
          lastMessageSeq: detail.lastMessageSeq,
          lastMessage: detail.lastMessage,
        };
        setConversations((prev) => (prev.some((c) => c.id === summary.id) ? prev : [summary, ...prev]));
        await open(summary);
      } catch {
      }
    })();
  }, [deepLinkId, listLoaded, conversations, open, queryClient, setConversations]);

  useEffect(() => {
    if (deepLinkId || !listLoaded || contextRestoredRef.current) return;
    if (sidebarTab === 'groups') {
      contextRestoredRef.current = true;
      return;
    }
    contextRestoredRef.current = true;
    const savedId = readStoredConversationId();
    if (!savedId) return;
    const found = conversations.find((c) => c.id === savedId);
    if (found) {
      void open(found);
      return;
    }
    void (async () => {
      try {
        const detail = await queryClient.fetchQuery(conversationDetailQueryOptions(savedId));
        const { messages: _detailMessages, hasMoreBefore: _hasMore, memberReadMarkers: _markers, ...summary } = detail;
        setConversations((prev) => (prev.some((c) => c.id === summary.id) ? prev : [summary, ...prev]));
        await open(summary);
      } catch {
      }
    })();
  }, [deepLinkId, listLoaded, conversations, open, queryClient, setConversations, sidebarTab]);
}
