import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBulkRemoveMessages, useDeleteMessageForMe, useHardDeleteMessage, useRecallMessage } from '../queries/messaging';
import type { ConversationView, MessageView } from '../types/types';

export interface UseMessageModerationParams {
  active: ConversationView | null;
  myId: string | undefined;
  patchMessages: (conversationId: string, updater: (messages: MessageView[]) => MessageView[]) => void;
  setActionMessage: (message: string | null) => void;
}

const RECALL_WINDOW_MINUTES = 15;

export function useMessageModeration({ active, myId, patchMessages, setActionMessage }: UseMessageModerationParams) {
  const { t } = useTranslation('app');
  const [selectedForBulk, setSelectedForBulk] = useState<Set<string>>(new Set());

  const deleteMessageMutation = useDeleteMessageForMe();
  const recallMessageMutation = useRecallMessage();
  const hardDeleteMutation = useHardDeleteMessage();
  const bulkRemoveMutation = useBulkRemoveMessages();

  async function deleteMessage(message: MessageView) {
    setActionMessage(null);
    try {
      const deleted = await deleteMessageMutation.mutateAsync(message.id);
      patchMessages(message.conversationId, (prev) =>
        prev.map((m) =>
          m.id === message.id
            ? {
                ...m,
                deletedAt: deleted.deletedAt ?? new Date().toISOString(),
                deletedBy: deleted.deletedBy ?? myId ?? null,
              }
            : m,
        ),
      );
    } catch {
      setActionMessage(t('deleteMessageFailed'));
    }
  }

  function canRecall(message: MessageView): boolean {
    if (message.userIdFrom !== myId || message.localStatus || message.recalledAt || message.deletedAt) return false;
    return Date.now() - new Date(message.createdAt).getTime() < RECALL_WINDOW_MINUTES * 60 * 1000;
  }

  async function recallMessage(message: MessageView) {
    setActionMessage(null);
    try {
      const recalled = await recallMessageMutation.mutateAsync(message.id);
      patchMessages(message.conversationId, (prev) =>
        prev.map((m) =>
          m.id === message.id
            ? {
                ...m,
                fullMessage: '',
                recalledAt: recalled.recalledAt ?? new Date().toISOString(),
                recalledBy: recalled.recalledBy ?? myId ?? null,
              }
            : m,
        ),
      );
    } catch {
      setActionMessage(t('recallMessageFailed'));
    }
  }

  async function hardDeleteMessage(message: MessageView) {
    setActionMessage(null);
    if (!window.confirm(t('hardDeleteConfirm'))) return;
    const reason = window.prompt(t('hardDeleteReasonPrompt'));
    if (!reason || !reason.trim()) return;
    try {
      await hardDeleteMutation.mutateAsync({ messageId: message.id, reason: reason.trim() });
      patchMessages(message.conversationId, (prev) => prev.filter((m) => m.id !== message.id));
      setSelectedForBulk((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    } catch {
      setActionMessage(t('hardDeleteMessageFailed'));
    }
  }

  async function bulkRemoveSelected() {
    setActionMessage(null);
    const messageIds = [...selectedForBulk];
    if (messageIds.length === 0) return;
    if (!window.confirm(t('bulkRemoveConfirm', { count: messageIds.length }))) return;
    const reason = window.prompt(t('bulkRemoveReasonPrompt'));
    if (!reason || !reason.trim()) return;
    try {
      await bulkRemoveMutation.mutateAsync({ messageIds, reason: reason.trim() });
      if (active) patchMessages(active.id, (prev) => prev.filter((m) => !selectedForBulk.has(m.id)));
      setSelectedForBulk(new Set());
    } catch {
      setActionMessage(t('bulkRemoveMessageFailed'));
    }
  }

  return {
    selectedForBulk,
    setSelectedForBulk,
    deleteMessage,
    canRecall,
    recallMessage,
    hardDeleteMessage,
    bulkRemoveSelected,
  };
}
