import { formatDateTime, formatWithOptions } from '#utils/date-format';

import type { MessageQuoteView, MessageView, PresenceStatus } from '../types/types';

export function quoteExcerptOfText(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= 120) return text;
  return `${chars.slice(0, 120).join('')}…`;
}

export function localQuoteOf(m: MessageView): MessageQuoteView {
  return {
    id: m.id,
    seq: m.seq,
    userIdFrom: m.userIdFrom,
    excerpt: m.recalledAt ? '' : quoteExcerptOfText(m.fullMessage),
    unavailable: Boolean(m.recalledAt),
  };
}

export function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return t('justNow');
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('daysAgo', { count: days });
  return formatDateTime(iso);
}

export function conversationTime(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  lang: string | undefined,
): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return t('justNow');
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t('minutesShort', { count: minutes });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diffDays <= 0) {
    return formatWithOptions(date, lang, { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (diffDays === 1) return t('messagesYesterday');
  return formatWithOptions(date, lang, { month: 'short', day: 'numeric' });
}

export const PRESENCE_DOT_CLASS: Record<PresenceStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-yellow-500',
  busy: 'bg-red-500',
  offline: 'bg-muted-foreground',
};

export function presenceStatusOf(isOnline: boolean | undefined): PresenceStatus | undefined {
  if (isOnline === undefined) return undefined;
  return isOnline ? 'online' : 'offline';
}

export function presenceLabelKey(status: PresenceStatus): string {
  switch (status) {
    case 'online': return 'onlineNow';
    case 'away': return 'presenceAway';
    case 'busy': return 'presenceBusy';
    default: return 'messagesOfflineNow';
  }
}

export const CHAT_MENU_CONTENT_CLASS = 'w-max min-w-52 max-w-[calc(100vw-2rem)]';

export const CHAT_MENU_ITEM_CLASS = 'whitespace-nowrap';

export function initialsOf(name: string): string {
  const letterWords = name
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).filter((ch) => /\p{L}/u.test(ch)).join(''))
    .filter(Boolean);
  if (letterWords.length === 0) return '?';
  if (letterWords.length === 1) return Array.from(letterWords[0]!).slice(0, 2).join('').toUpperCase();
  const first = Array.from(letterWords[0]!)[0]!;
  const last = Array.from(letterWords[letterWords.length - 1]!)[0]!;
  return (first + last).toUpperCase();
}

export function mergeMessages(existing: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map<string, MessageView>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) {
    if (m.clientMessageId) {
      for (const [id, local] of byId) {
        if (local.localStatus && local.clientMessageId === m.clientMessageId) byId.delete(id);
      }
    }
    byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => (a.seq || Number.MAX_SAFE_INTEGER) - (b.seq || Number.MAX_SAFE_INTEGER));
}

export function countMessageCharacters(text: string): number {
  const SegmenterCtor = (Intl as unknown as {
    Segmenter?: new (locales?: string, options?: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<unknown>;
    };
  }).Segmenter;
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _segment of segmenter.segment(text)) count += 1;
    return count;
  }
  return [...text].length;
}
