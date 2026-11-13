import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MESSAGING_MAX_MESSAGE_LENGTH_DEFAULT } from '@giaokhoa/contracts';
import { ApiError } from '#lib/api';
import { useSendMessage } from '../queries/messaging';
import type { MessagingRealtimeHandle } from '../api/messaging-socket';
import { countMessageCharacters, localQuoteOf } from '../utils/utils';
import type { ConversationView, MessageQuoteView, MessageView } from '../types/types';

export interface UseMessageComposerParams {
  active: ConversationView | null;
  myId: string | undefined;
  addLocalMessage: (message: MessageView) => void;
  setLocalMessageStatus: (conversationId: string, clientMessageId: string, status: 'sending' | 'failed') => void;
  mergeServerMessages: (conversationId: string, messages: MessageView[]) => void;
  lastSeqRef: { current: Map<string, number> };
  realtimeRef: { current: MessagingRealtimeHandle | null };
}

export function useMessageComposer({
  active,
  myId,
  addLocalMessage,
  setLocalMessageStatus,
  mergeServerMessages,
  lastSeqRef,
  realtimeRef,
}: UseMessageComposerParams) {
  const { t } = useTranslation('app');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyTargets, setReplyTargets] = useState<Record<string, MessageView | null>>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const sendMessageMutation = useSendMessage();
  const lastTypingSentRef = useRef(0);
  const draftClientIdRef = useRef<Map<string, string>>(new Map());
  const sendInFlightRef = useRef<Set<string>>(new Set());
  const [sendingConversationIds, setSendingConversationIds] = useState<ReadonlySet<string>>(new Set());

  async function deliver(
    conversationId: string,
    text: string,
    clientMessageId: string,
    quote?: { replyToMessageId: string; replyTo: MessageQuoteView } | null,
  ) {
    if (!myId) return;
    addLocalMessage({
      id: `temp-${clientMessageId}`,
      conversationId,
      userIdFrom: myId,
      fullMessage: text,
      createdAt: new Date().toISOString(),
      seq: 0,
      clientMessageId,
      replyToMessageId: quote?.replyToMessageId ?? null,
      replyTo: quote?.replyTo ?? null,
      localStatus: 'sending',
    });
    try {
      const saved = await sendMessageMutation.mutateAsync({
        conversationId,
        body: {
          text,
          clientMessageId,
          ...(quote ? { replyToMessageId: quote.replyToMessageId } : {}),
        },
      });
      const seen = lastSeqRef.current.get(conversationId) ?? 0;
      if (saved.seq > seen) lastSeqRef.current.set(conversationId, saved.seq);
      mergeServerMessages(conversationId, [saved]);
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === 'messaging.message_too_long') {
        setSendError(t('messageTooLong', { max: MESSAGING_MAX_MESSAGE_LENGTH_DEFAULT }));
      } else if (err instanceof ApiError && err.problem.code === 'messaging.rate_limited') {
        setSendError(t('messageRateLimited'));
      }
      setLocalMessageStatus(conversationId, clientMessageId, 'failed');
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    if (sendInFlightRef.current.has(active.id)) return;
    const text = drafts[active.id] ?? '';
    if (!text.trim()) return;
    if (countMessageCharacters(text) > MESSAGING_MAX_MESSAGE_LENGTH_DEFAULT) {
      setSendError(t('messageTooLong', { max: MESSAGING_MAX_MESSAGE_LENGTH_DEFAULT }));
      return;
    }
    let clientMessageId = draftClientIdRef.current.get(active.id);
    if (!clientMessageId) {
      clientMessageId = crypto.randomUUID();
      draftClientIdRef.current.set(active.id, clientMessageId);
    }
    sendInFlightRef.current.add(active.id);
    setSendingConversationIds((prev) => new Set(prev).add(active.id));
    try {
      setSendError(null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[active.id];
        return next;
      });
      const target = replyTargets[active.id] ?? null;
      setReplyTargets((prev) => {
        const next = { ...prev };
        delete next[active.id];
        return next;
      });
      await deliver(
        active.id,
        text,
        clientMessageId,
        target ? { replyToMessageId: target.id, replyTo: localQuoteOf(target) } : null,
      );
      if (draftClientIdRef.current.get(active.id) === clientMessageId) {
        draftClientIdRef.current.delete(active.id);
      }
    } finally {
      sendInFlightRef.current.delete(active.id);
      setSendingConversationIds((prev) => {
        const next = new Set(prev);
        next.delete(active.id);
        return next;
      });
    }
  }

  async function retrySend(message: MessageView) {
    if (!active || !message.clientMessageId) return;
    setLocalMessageStatus(active.id, message.clientMessageId, 'sending');
    await deliver(
      active.id,
      message.fullMessage,
      message.clientMessageId,
      message.replyToMessageId && message.replyTo
        ? { replyToMessageId: message.replyToMessageId, replyTo: message.replyTo }
        : null,
    );
  }

  function noteTyping() {
    if (!active) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    realtimeRef.current?.typing(active.id);
  }

  function resetComposerForOpen() {
    setSendError(null);
  }

  const draft = active ? (drafts[active.id] ?? '') : '';
  const replyTarget = active ? (replyTargets[active.id] ?? null) : null;

  return {
    drafts,
    setDrafts,
    replyTargets,
    setReplyTargets,
    sendError,
    sendingConversationIds,
    send,
    retrySend,
    noteTyping,
    resetComposerForOpen,
    draft,
    replyTarget,
  };
}
