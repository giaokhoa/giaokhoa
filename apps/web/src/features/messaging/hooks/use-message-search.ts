import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { messageSearchQueryOptions } from '../queries/messaging';
import { queryKeys } from '../queries/keys';
import type { ConversationView, MessageQuoteView, MessageSearchResultView, MessageView, ScrollerHandle } from '../types/types';

export interface UseMessageSearchParams {
  active: ConversationView | null;
  messages: MessageView[];
  ensurePageLoaded: (beforeSeq: number) => Promise<{ messages: MessageView[]; hasMoreBefore: boolean } | null>;
}

const EMPTY_SEARCH: {
  query: string;
  results: MessageSearchResultView[];
  loading: boolean;
  failed: boolean;
  submitted: boolean;
} = { query: '', results: [], loading: false, failed: false, submitted: false };

export function useMessageSearch({ active, messages, ensurePageLoaded }: UseMessageSearchParams) {
  const queryClient = useQueryClient();
  const [submitted, setSubmitted] = useState<{ conversationId: string; q: string } | null>(null);
  const searchQuery = useQuery({
    ...messageSearchQueryOptions(submitted?.conversationId ?? '', submitted?.q ?? ''),
    enabled: !!submitted,
  });
  const messageSearch =
    submitted && active && submitted.conversationId === active.id
      ? {
          query: submitted.q,
          results: searchQuery.data?.results ?? [],
          loading: searchQuery.isFetching,
          failed: searchQuery.isError,
          submitted: true,
        }
      : EMPTY_SEARCH;
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const scrollerRef = useRef<ScrollerHandle | null>(null);

  async function jumpToMessage(messageId: string, seq: number) {
    if (!active) return;
    const scrollAndHighlight = () => {
      setHighlightedMessageId(messageId);
      let attempts = 0;
      const tryScroll = () => {
        attempts += 1;
        const ok = scrollerRef.current?.scrollToMessage(messageId, { behavior: 'smooth' }) ?? false;
        if (!ok && attempts < 6) setTimeout(tryScroll, 60);
      };
      tryScroll();
      setTimeout(() => {
        setHighlightedMessageId((cur) => (cur === messageId ? null : cur));
      }, 2400);
    };
    if (messages.some((m) => m.id === messageId)) {
      scrollAndHighlight();
      return;
    }
    try {
      const page = await ensurePageLoaded(seq + 1);
      if (page && page.messages.some((m) => m.id === messageId)) scrollAndHighlight();
    } catch {
    }
  }

  async function jumpToQuotedMessage(quote: MessageQuoteView) {
    await jumpToMessage(quote.id, quote.seq);
  }

  async function runMessageSearch(rawQuery: string) {
    if (!active) return;
    const q = rawQuery.trim();
    if (!q) {
      setSubmitted(null);
      return;
    }
    if (submitted && submitted.conversationId === active.id && submitted.q === q) {
      await queryClient.refetchQueries({ queryKey: queryKeys.messagingSearch(active.id, q) });
      return;
    }
    setSubmitted({ conversationId: active.id, q });
  }

  function clearMessageSearch() {
    setSubmitted(null);
  }

  return {
    messageSearch,
    highlightedMessageId,
    scrollerRef,
    jumpToMessage,
    jumpToQuotedMessage,
    runMessageSearch,
    clearMessageSearch,
  };
}
