import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '#lib/api';
import { classConversationQueryOptions, conversationDetailQueryOptions, courseConversationQueryOptions, useCreateFreeGroup, useCreateGroupConversation, useRemoveConversationMember, useReportConversation, useSetConversationEnabled } from '../queries/messaging';
import type { ConversationGroupTreeView, ConversationView } from '../types/types';

export interface UseGroupActionsParams {
  active: ConversationView | null;
  setConversations: (conversations: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => void;
  conversations: ConversationView[];
  archivedConversations: ConversationView[];
  groupTree: ConversationGroupTreeView | null;
  nameOf: (userId: string) => string;
  reload: () => Promise<void>;
  open: (conv: ConversationView) => Promise<void> | void;
  setPanelRefreshTick: (tick: number | ((prev: number) => number)) => void;
}

export function useGroupActions({
  active,
  setConversations,
  conversations,
  archivedConversations,
  groupTree,
  nameOf,
  reload,
  open,
  setPanelRefreshTick,
}: UseGroupActionsParams) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const groupConversationMutation = useCreateGroupConversation();
  const freeGroupMutation = useCreateFreeGroup();
  const reportConversationMutation = useReportConversation();
  const removeMemberMutation = useRemoveConversationMember();
  const conversationEnabledMutation = useSetConversationEnabled();

  async function openConversationById(conversationId: string) {
    const found =
      conversations.find((c) => c.id === conversationId) ?? archivedConversations.find((c) => c.id === conversationId);
    if (found) {
      await open(found);
      return;
    }
    try {
      const detail = await queryClient.fetchQuery(conversationDetailQueryOptions(conversationId));
      const { messages: _detailMessages, hasMoreBefore: _hasMore, memberReadMarkers: _markers, ...summary } = detail;
      setConversations((prev) => (prev.some((c) => c.id === summary.id) ? prev : [summary, ...prev]));
      await open(summary);
    } catch {
    }
  }

  async function openClassChat(classId: string) {
    try {
      const conv = await queryClient.fetchQuery(classConversationQueryOptions(classId));
      await reload();
      await open(conv);
    } catch {
    }
  }

  async function openCourseChat(courseId: string) {
    try {
      const conv = await queryClient.fetchQuery(courseConversationQueryOptions(courseId));
      await reload();
      await open(conv);
    } catch {
    }
  }

  async function openGroupConversation(groupId: string) {
    try {
      const conv = await groupConversationMutation.mutateAsync(groupId);
      await reload();
      await open(conv);
    } catch {
    }
  }

  async function createFreeGroup(name: string, memberIds: string[]): Promise<boolean> {
    setGroupCreateError(null);
    try {
      const conv = await freeGroupMutation.mutateAsync({ name, memberIds });
      await reload();
      await open(conv);
      return true;
    } catch (err) {
      setGroupCreateError(
        err instanceof ApiError && err.problem.code === 'messaging.group_creation_forbidden'
          ? t('groupCreateForbidden')
          : t('groupCreateFailed'),
      );
      return false;
    }
  }

  async function reportActiveConversation() {
    if (!active) return;
    setReportMessage(null);
    try {
      await reportConversationMutation.mutateAsync(active.id);
      setReportMessage(t('conversationReported'));
    } catch {
      setReportMessage(t('reportFailed'));
    }
  }

  async function removeGroupMember(userId: string) {
    if (!active) return;
    if (!window.confirm(t('memberRemoveConfirm', { name: nameOf(userId) }))) return;
    setActionMessage(null);
    try {
      await removeMemberMutation.mutateAsync({ conversationId: active.id, userId });
      setPanelRefreshTick((n) => n + 1);
      setActionMessage(t('memberRemoved'));
    } catch {
      setActionMessage(t('memberRemoveFailed'));
    }
  }

  async function toggleActiveChat() {
    if (!active) return;
    await conversationEnabledMutation.mutateAsync({
      conversationId: active.id,
      enabled: !(active.enabled ?? true),
    });
  }

  function clearActionMessages() {
    setReportMessage(null);
    setActionMessage(null);
  }

  const canCreateFreeGroup = groupTree?.canCreateFreeGroup ?? false;

  return {
    groupCreateError,
    reportMessage,
    setReportMessage,
    actionMessage,
    setActionMessage,
    openConversationById,
    openClassChat,
    openCourseChat,
    openGroupConversation,
    createFreeGroup,
    reportActiveConversation,
    removeGroupMember,
    toggleActiveChat,
    clearActionMessages,
    canCreateFreeGroup,
  };
}
