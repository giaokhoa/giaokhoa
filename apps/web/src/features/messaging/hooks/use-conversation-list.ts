import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { messagingArchivedConversationsQueryOptions, messagingConversationsQueryOptions, messagingCoursesQueryOptions, messagingGroupTreeQueryOptions, useMarkConversationRead, useSetConversationState } from '../queries/messaging';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as messagingQueryKeys } from '../queries/keys';
import { readStoredMessagesTab, storeMessagesTab, withTreeUnread } from '../utils/page-helpers';
import type {
  ConversationGroupTreeView,
  ConversationStatePatch,
  ConversationView,
  PersonSummary,
} from '../types/types';

export interface UseConversationListParams {
  myId: string | undefined;
  applyReadMarker: (conversationId: string, userId: string, lastReadSeq: number) => void;
  lastSeqRef: { current: Map<string, number> };
}

export function useConversationList({ myId, applyReadMarker, lastSeqRef }: UseConversationListParams) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();

  const conversationsQuery = useQuery(messagingConversationsQueryOptions());
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
  const archivedQuery = useQuery(messagingArchivedConversationsQueryOptions());
  const archivedConversations = useMemo(() => archivedQuery.data ?? [], [archivedQuery.data]);
  const archivedLoading = archivedQuery.isPending;
  const archivedError =
    archivedQuery.isError && !archivedQuery.data ? t('archivedLoadFailed') : null;
  const refetchArchived = archivedQuery.refetch;
  const retryArchived = useCallback(() => {
    void refetchArchived();
  }, [refetchArchived]);
  const groupTreeQuery = useQuery(messagingGroupTreeQueryOptions());
  const groupTree = groupTreeQuery.data ?? null;
  const groupTreeLoading = groupTreeQuery.isPending;
  const groupTreeError =
    groupTreeQuery.isError && !groupTreeQuery.data ? t('groupTreeLoadFailed') : null;
  const coursesQuery = useQuery(messagingCoursesQueryOptions());
  const myCourses = useMemo(() => coursesQuery.data?.courses ?? [], [coursesQuery.data]);

  const [stateError, setStateError] = useState<string | null>(null);
  const error =
    conversationsQuery.isError && !conversationsQuery.data ? t('messagesLoadFailed') : null;
  const listLoaded = conversationsQuery.isSuccess;
  const [people, setPeople] = useState<Record<string, PersonSummary>>({});
  const [sidebarTab, setSidebarTabState] = useState<string>(() => readStoredMessagesTab());

  const unread = useMemo(() => conversations.filter((c) => (c.unread ?? 0) > 0).length, [conversations]);
  const recountUnread = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.messageUnreadCount });
  }, [queryClient]);

  const mergePeople = useCallback((profiles: Record<string, PersonSummary> | undefined) => {
    if (!profiles) return;
    setPeople((prev) => ({ ...prev, ...profiles }));
  }, []);

  const nameOf = useCallback((userId: string) => people[userId]?.displayName ?? userId, [people]);

  const [mergedProfilesSource, setMergedProfilesSource] = useState<{
    list?: ConversationView[];
    archived?: ConversationView[];
  }>({});
  if (
    conversationsQuery.data !== mergedProfilesSource.list ||
    archivedQuery.data !== mergedProfilesSource.archived
  ) {
    setMergedProfilesSource({ list: conversationsQuery.data, archived: archivedQuery.data });
    for (const c of conversationsQuery.data ?? []) mergePeople(c.memberProfiles);
    for (const c of archivedQuery.data ?? []) mergePeople(c.memberProfiles);
  }
  useEffect(() => {
    for (const c of [...conversations, ...archivedConversations]) {
      if (c.lastMessageSeq !== undefined) {
        const seen = lastSeqRef.current.get(c.id) ?? 0;
        if (c.lastMessageSeq > seen) lastSeqRef.current.set(c.id, c.lastMessageSeq);
      }
    }
  }, [conversations, archivedConversations, lastSeqRef]);

  const setConversations = useCallback(
    (updater: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => {
      queryClient.setQueryData<ConversationView[]>(messagingQueryKeys.messagingConversations, (old) =>
        typeof updater === 'function' ? updater(old ?? []) : updater,
      );
    },
    [queryClient],
  );

  const setArchivedConversations = useCallback(
    (updater: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => {
      queryClient.setQueryData<ConversationView[]>(messagingQueryKeys.messagingArchivedConversations, (old) =>
        typeof updater === 'function' ? updater(old ?? []) : updater,
      );
    },
    [queryClient],
  );

  const setGroupTree = useCallback(
    (
      updater:
        | ConversationGroupTreeView
        | null
        | ((prev: ConversationGroupTreeView | null) => ConversationGroupTreeView | null),
    ) => {
      queryClient.setQueryData<ConversationGroupTreeView | null>(messagingQueryKeys.messagingGroupTree, (old) =>
        typeof updater === 'function'
          ? (updater as (prev: ConversationGroupTreeView | null) => ConversationGroupTreeView | null)(old ?? null)
          : updater,
      );
    },
    [queryClient],
  );

  const conversationStateMutation = useSetConversationState();
  const markReadMutation = useMarkConversationRead();

  const loadGroupTree = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingGroupTree });
  }, [queryClient]);

  const setSidebarTab = useCallback((value: string) => {
    setSidebarTabState(value);
    storeMessagesTab(value);
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingConversations }),
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingArchivedConversations }),
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingGroupTree }),
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingCourses }),
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingContacts }),
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingContactRequests }),
      queryClient.invalidateQueries({ queryKey: messagingQueryKeys.messagingBlockedContacts }),
    ]);
  }, [queryClient]);

  const updateConversationState = useCallback(
    async (conversation: ConversationView, patch: ConversationStatePatch) => {
      setStateError(null);
      try {
        await conversationStateMutation.mutateAsync({ conversationId: conversation.id, patch });
      } catch {
        setStateError(t('conversationStateFailed'));
      }
    },
    [conversationStateMutation, t],
  );

  const markRead = useCallback(
    async (conversationId: string) => {
      try {
        const res = await markReadMutation.mutateAsync(conversationId);
        if (myId) applyReadMarker(conversationId, myId, res.lastReadSeq);
        setGroupTree((prev) => withTreeUnread(prev, conversationId, 0));
      } catch {
      }
    },
    [applyReadMarker, markReadMutation, myId, setGroupTree],
  );

  return {
    conversations,
    setConversations,
    archivedConversations,
    archivedLoading,
    archivedError,
    retryArchived,
    setArchivedConversations,
    stateError,
    listLoaded,
    unread,
    error,
    people,
    myCourses,
    groupTree,
    groupTreeLoading,
    groupTreeError,
    setGroupTree,
    sidebarTab,
    setSidebarTab,
    recountUnread,
    mergePeople,
    nameOf,
    loadGroupTree,
    reload,
    updateConversationState,
    markRead,
  };
}
