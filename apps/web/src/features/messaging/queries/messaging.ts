import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  bulkRemoveMessages, createDirectConversation, createFreeGroup, createGroupConversation, deleteMessageForMe,
  fetchClassConversation, fetchConversationDetail, fetchConversationMessagesPage, fetchCourseConversation,
  fetchMessagingArchivedConversations, fetchMessagingBlockedContacts, fetchMessagingContactRequests,
  fetchMessagingContacts, fetchMessagingConversations, fetchMessagingCourses, fetchMessagingGroupTree,
  fetchMessagingPersonProfile,
  fetchRosterPage, hardDeleteMessage, markConversationRead, recallMessage, removeConversationMember,
  reportConversation, respondContactRequest, searchConversationMessages, sendContactRequest, sendMessage,
  setContactBlocked, setConversationEnabled, setConversationState,
} from '../api/messaging';
import type {
  ConversationDetailView,
  ConversationStatePatch,
  ConversationView,
  PersonSummary,
} from '../types/types';
import { withConversationMovedToSectionTop } from '../utils/page-helpers';
import { queryKeys } from './keys';


export function messagingGroupTreeQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingGroupTree,
    queryFn: () => fetchMessagingGroupTree(),
  });
}

export function messagingConversationsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingConversations,
    queryFn: () => fetchMessagingConversations(),
  });
}

export function messagingPersonProfileQueryOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.messagingPersonProfile(userId),
    queryFn: () => fetchMessagingPersonProfile(userId),
  });
}

export function messagingArchivedConversationsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingArchivedConversations,
    queryFn: () => fetchMessagingArchivedConversations(),
  });
}

export function messagingBlockedContactsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingBlockedContacts,
    queryFn: () => fetchMessagingBlockedContacts(),
  });
}

export function messagingContactsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingContacts,
    queryFn: () => fetchMessagingContacts(),
  });
}

export function messagingContactRequestsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingContactRequests,
    queryFn: () => fetchMessagingContactRequests(),
  });
}

export function messagingCoursesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.messagingCourses,
    queryFn: () => fetchMessagingCourses(),
  });
}

export function conversationDetailQueryOptions(conversationId: string) {
  return queryOptions({
    queryKey: queryKeys.messagingConversationDetail(conversationId),
    queryFn: () => fetchConversationDetail(conversationId),
  });
}

export function conversationMessagesPageQueryOptions(conversationId: string, beforeSeq: number) {
  return queryOptions({
    queryKey: queryKeys.messagingMessagesPage(conversationId, beforeSeq),
    queryFn: () => fetchConversationMessagesPage(conversationId, beforeSeq),
  });
}

export function messageSearchQueryOptions(conversationId: string, q: string) {
  return queryOptions({
    queryKey: queryKeys.messagingSearch(conversationId, q),
    queryFn: () => searchConversationMessages(conversationId, q),
  });
}

export function rosterPageQueryOptions(url: string) {
  return queryOptions({
    queryKey: queryKeys.messagingRosterPage(url),
    queryFn: () => fetchRosterPage(url),
  });
}

export function classConversationQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.messagingClassConversation(classId),
    queryFn: () => fetchClassConversation(classId),
  });
}

export function courseConversationQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.courseConversation(courseId),
    queryFn: () => fetchCourseConversation(courseId),
  });
}

export function useSetConversationState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, patch }: { conversationId: string; patch: ConversationStatePatch }) =>
      setConversationState(conversationId, patch),
    onSuccess: (_data, { conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingArchivedConversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversationDetail(conversationId) });
    },
  });
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => markConversationRead(conversationId),
    onSuccess: (res, conversationId) => {
      const applyRead = (old: ConversationView[] | undefined) =>
        old?.map((c) => (c.id === conversationId ? { ...c, unread: 0, lastReadSeq: res.lastReadSeq } : c));
      queryClient.setQueryData<ConversationView[]>(queryKeys.messagingConversations, applyRead);
      queryClient.setQueryData<ConversationView[]>(queryKeys.messagingArchivedConversations, applyRead);
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.messageUnreadCount });
    },
  });
}

export function useSetContactBlocked() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, block }: { userId: string; block: boolean }) => setContactBlocked(userId, block),
    onSuccess: (res) => {
      queryClient.setQueryData<{ blocked: string[]; profiles?: Record<string, PersonSummary> }>(
        queryKeys.messagingBlockedContacts,
        (old) => (old ? { ...old, blocked: res.blocked } : old),
      );
    },
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body }: { conversationId: string; body: Record<string, unknown> }) =>
      sendMessage(conversationId, body),
    onSuccess: (saved, { conversationId }) => {
      queryClient.setQueryData<ConversationView[]>(queryKeys.messagingConversations, (old) => {
        if (!old) return old;
        const target = old.find((c) => c.id === conversationId);
        if (!target) return old;
        return [
          { ...target, lastMessage: saved, lastMessageSeq: saved.seq },
          ...old.filter((c) => c.id !== conversationId),
        ];
      });
      queryClient.setQueryData<ConversationView[]>(queryKeys.messagingArchivedConversations, (old) =>
        old
          ? withConversationMovedToSectionTop(old, conversationId, (c) => ({
              ...c,
              lastMessage: saved,
              lastMessageSeq: saved.seq,
            }))
          : old,
      );
    },
  });
}

export function useSendContactRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => sendContactRequest(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingContactRequests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingContacts });
    },
  });
}

export function useRespondContactRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: 'accept' | 'decline' }) =>
      respondContactRequest(userId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingContactRequests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingContacts });
    },
  });
}

export function useCreateDirectConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => createDirectConversation(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations });
    },
  });
}

export function useCreateGroupConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => createGroupConversation(groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingGroupTree });
    },
  });
}

export function useCreateFreeGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, memberIds }: { name: string; memberIds: string[] }) => createFreeGroup(name, memberIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingGroupTree });
    },
  });
}

export function useReportConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => reportConversation(conversationId),
    onSuccess: (_data, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversationDetail(conversationId) });
    },
  });
}

export function useRemoveConversationMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string }) =>
      removeConversationMember(conversationId, userId),
    onSuccess: (updated, { conversationId }) => {
      queryClient.setQueryData<ConversationView[]>(queryKeys.messagingConversations, (old) =>
        old?.map((c) => (c.id === conversationId ? { ...c, members: updated.members } : c)),
      );
      queryClient.setQueryData<ConversationDetailView>(queryKeys.messagingConversationDetail(conversationId), (old) =>
        old ? { ...old, ...updated } : old,
      );
    },
  });
}

export function useSetConversationEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, enabled }: { conversationId: string; enabled: boolean }) =>
      setConversationEnabled(conversationId, enabled),
    onSuccess: (updated, { conversationId }) => {
      queryClient.setQueryData<ConversationView[]>(queryKeys.messagingConversations, (old) =>
        old?.map((c) => (c.id === conversationId ? { ...c, enabled: updated.enabled } : c)),
      );
      queryClient.setQueryData<ConversationDetailView>(queryKeys.messagingConversationDetail(conversationId), (old) =>
        old ? { ...old, ...updated } : old,
      );
    },
  });
}

export function useDeleteMessageForMe() {
  return useMutation({
    mutationFn: (messageId: string) => deleteMessageForMe(messageId),
  });
}

export function useRecallMessage() {
  return useMutation({
    mutationFn: (messageId: string) => recallMessage(messageId),
  });
}

export function useHardDeleteMessage() {
  return useMutation({
    mutationFn: ({ messageId, reason }: { messageId: string; reason: string }) => hardDeleteMessage(messageId, reason),
  });
}

export function useBulkRemoveMessages() {
  return useMutation({
    mutationFn: ({ messageIds, reason }: { messageIds: string[]; reason: string }) =>
      bulkRemoveMessages(messageIds, reason),
  });
}
