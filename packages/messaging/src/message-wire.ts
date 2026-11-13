import type { GiaoKhoaMessage } from '@giaokhoa/contracts';
import type {
  ConversationRow,
  MessageQuoteView,
  MessageRow,
  MessageWithQuoteRow,
} from '@giaokhoa/db/repositories/messaging';

export type { ConversationRow, MessageQuoteView, MessageRow, MessageWithQuoteRow };

export function blankRecalledContent(row: MessageRow): MessageRow {
  if (!row.recalledAt) return row;
  return { ...row, fullMessage: '', smallMessage: '' };
}

export const QUOTE_EXCERPT_MAX_CHARS = 120;

export function quoteExcerptOf(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= QUOTE_EXCERPT_MAX_CHARS) return text;
  return `${chars.slice(0, QUOTE_EXCERPT_MAX_CHARS).join('')}…`;
}

export function messageQuoteOf(original: MessageRow, opts: { privileged: boolean; deletedForViewer?: boolean }): MessageQuoteView {
  const unavailable = !opts.privileged
    && (original.deletedAt !== null || original.recalledAt !== null || opts.deletedForViewer === true);
  return {
    id: original.id,
    seq: original.seq,
    userIdFrom: original.userIdFrom,
    excerpt: unavailable ? '' : quoteExcerptOf(original.fullMessage),
    unavailable,
  };
}

export function toWireMessage(row: MessageRow, quote: MessageQuoteView | null = null): GiaoKhoaMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    userIdFrom: row.userIdFrom,
    subject: row.subject,
    fullMessage: row.fullMessage,
    createdAt: row.createdAt.toISOString(),
    seq: row.seq,
    clientMessageId: row.clientMessageId,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedBy: row.deletedBy,
    recalledAt: row.recalledAt ? row.recalledAt.toISOString() : null,
    recalledBy: row.recalledBy,
    replyToMessageId: row.replyToMessageId,
    replyTo: quote,
  };
}

export const SEARCH_EXCERPT_MAX_CHARS = QUOTE_EXCERPT_MAX_CHARS;

export function searchExcerptOf(text: string, query: string): string {
  const chars = Array.from(text);
  if (chars.length <= SEARCH_EXCERPT_MAX_CHARS) return text;
  const at = text.toLocaleLowerCase('vi').indexOf(query.toLocaleLowerCase('vi'));
  if (at < 0) return quoteExcerptOf(text);
  const matchStart = Array.from(text.slice(0, at)).length;
  const matchLength = Array.from(query).length;
  const before = Math.max(0, Math.floor((SEARCH_EXCERPT_MAX_CHARS - matchLength) / 2));
  const start = Math.max(0, matchStart - before);
  const end = Math.min(chars.length, start + SEARCH_EXCERPT_MAX_CHARS);
  const slice = chars.slice(start, end).join('');
  return `${start > 0 ? '…' : ''}${slice}${end < chars.length ? '…' : ''}`;
}
