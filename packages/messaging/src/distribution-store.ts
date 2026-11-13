import { sql, type SqlBool } from '@giaokhoa/db';
import type { CentreDb, CentreTx } from '@giaokhoa/db';
import type {
  ConversationRow,
  MessageRow,
  MessageWindowOptions,
  MessageWithQuoteRow,
  MessagingStorePort,
} from '@giaokhoa/db/repositories/messaging';
import { messageQuoteOf } from './message-wire.js';

export type MessagingDatabase = CentreDb | CentreTx;

export type { MessageWindowOptions } from '@giaokhoa/db/repositories/messaging';


const CONVERSATION_COLUMNS = [
  'id',
  'type',
  'name',
  'component',
  'item_type as itemType',
  'item_id as itemId',
  'context_id as contextId',
  'enabled',
  'created_by as createdBy',
  'tenant_id as tenantId',
  'last_message_seq as lastMessageSeq',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const MESSAGE_COLUMNS = [
  'id',
  'conversation_id as conversationId',
  'user_id_from as userIdFrom',
  'subject',
  'full_message as fullMessage',
  'small_message as smallMessage',
  'seq',
  'client_message_id as clientMessageId',
  'reply_to_message_id as replyToMessageId',
  'deleted_at as deletedAt',
  'deleted_by as deletedBy',
  'recalled_at as recalledAt',
  'recalled_by as recalledBy',
  'created_at as createdAt',
] as const;

export async function getConversationById(db: MessagingDatabase, id: string): Promise<ConversationRow | undefined> {
  return db
    .selectFrom('message_conversations')
    .select(CONVERSATION_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst() as Promise<ConversationRow | undefined>;
}

export async function listConversationMemberIds(db: MessagingDatabase, conversationId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('message_conversation_members')
    .select('user_id as userId')
    .where('conversation_id', '=', conversationId)
    .execute();
  return rows.map((r) => r.userId);
}

export async function getConversationTenantId(db: MessagingDatabase, conversationId: string): Promise<string | null> {
  const row = await db
    .selectFrom('message_conversations')
    .select('tenant_id as tenantId')
    .where('id', '=', conversationId)
    .executeTakeFirst();
  return row?.tenantId ?? null;
}

export async function getMessageById(db: MessagingDatabase, id: string): Promise<MessageRow | undefined> {
  return db
    .selectFrom('message')
    .select(MESSAGE_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst() as Promise<MessageRow | undefined>;
}

export async function getMessagesByIds(db: MessagingDatabase, ids: string[]): Promise<MessageRow[]> {
  if (ids.length === 0) return [];
  return db
    .selectFrom('message')
    .select(MESSAGE_COLUMNS)
    .where('id', 'in', ids)
    .execute() as Promise<MessageRow[]>;
}

export async function listMessagesPage(db: MessagingDatabase, conversationId: string, opts: MessageWindowOptions = {}): Promise<MessageRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  let base = db
    .selectFrom('message')
    .select(MESSAGE_COLUMNS)
    .where('conversation_id', '=', conversationId);
  if (!opts.includeDeleted) base = base.where('deleted_at', 'is', null);
  if (opts.viewerId && !opts.includeDeleted) {
    const viewerId = opts.viewerId;
    base = base.where(sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${viewerId})`);
  }
  if (opts.afterSeq !== undefined) {
    return base
      .where('seq', '>', opts.afterSeq)
      .orderBy('seq', 'asc')
      .limit(limit)
      .execute() as Promise<MessageRow[]>;
  }
  if (opts.beforeSeq !== undefined) base = base.where('seq', '<', opts.beforeSeq);
  const rows = await base.orderBy('seq', 'desc').limit(limit).execute();
  return (rows as MessageRow[]).reverse();
}

export async function listDeletedForUserIds(db: MessagingDatabase, messageIds: string[], userId: string): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const rows = await db
    .selectFrom('message_user_deletions')
    .select('message_id as messageId')
    .where('message_id', 'in', messageIds)
    .where('user_id', '=', userId)
    .execute();
  return new Set(rows.map((r) => r.messageId));
}

export async function attachQuotesToRows(
  db: MessagingDatabase,
  rows: MessageRow[],
  opts: { privileged: boolean; viewerId?: string },
): Promise<MessageWithQuoteRow[]> {
  const originalIds = [...new Set(rows.map((r) => r.replyToMessageId).filter((id): id is string => id !== null))];
  if (originalIds.length === 0) return rows.map((r) => ({ ...r, replyTo: null }));
  const originals = await getMessagesByIds(db, originalIds);
  const byId = new Map(originals.map((o) => [o.id, o]));
  const deletedForViewer = !opts.privileged && opts.viewerId
    ? await listDeletedForUserIds(db, originalIds, opts.viewerId)
    : new Set<string>();
  return rows.map((r) => {
    if (!r.replyToMessageId) return { ...r, replyTo: null };
    const original = byId.get(r.replyToMessageId);
    if (!original || original.conversationId !== r.conversationId) return { ...r, replyTo: null };
    return {
      ...r,
      replyTo: messageQuoteOf(original, {
        privileged: opts.privileged,
        deletedForViewer: deletedForViewer.has(original.id),
      }),
    };
  });
}

export async function getMemberLastReadSeq(db: MessagingDatabase, conversationId: string, userId: string): Promise<number | undefined> {
  const row = await db
    .selectFrom('message_conversation_members')
    .select('last_read_seq as lastReadSeq')
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.lastReadSeq;
}

export async function countUnreadForConversation(db: MessagingDatabase, conversationId: string, userId: string): Promise<number> {
  const member = await db
    .selectFrom('message_conversation_members')
    .select(['last_read_seq as lastReadSeq', 'muted'])
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!member || member.muted) return 0;
  const lastReadSeq = member.lastReadSeq;
  const row = await db
    .selectFrom('message')
    .select(sql<number>`count(*)::int`.as('value'))
    .where((eb) => eb.and([
      eb('conversation_id', '=', conversationId),
      eb('seq', '>', lastReadSeq),
      eb('user_id_from', '<>', userId),
      eb('deleted_at', 'is', null),
      eb('recalled_at', 'is', null),
      sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${userId})`,
    ]))
    .executeTakeFirst();
  return row?.value ?? 0;
}

export async function listBlockedUserIds(db: MessagingDatabase, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('message_users_blocked')
    .select('blocked_user_id as blockedUserId')
    .where('user_id', '=', userId)
    .execute();
  return rows.map((r) => r.blockedUserId);
}

export async function listBlockerUserIds(db: MessagingDatabase, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('message_users_blocked')
    .select('user_id as userId')
    .where('blocked_user_id', '=', userId)
    .execute();
  return rows.map((r) => r.userId);
}

export async function listBlockedCounterpartIds(db: MessagingDatabase, userId: string): Promise<string[]> {
  const [blocked, blockers] = await Promise.all([listBlockedUserIds(db, userId), listBlockerUserIds(db, userId)]);
  return [...new Set([...blocked, ...blockers])];
}

export function createMessagingStore(db: MessagingDatabase): MessagingStorePort {
  return {
    getConversationById: (id) => getConversationById(db, id),
    listConversationMemberIds: (conversationId) => listConversationMemberIds(db, conversationId),
    getConversationTenantId: (conversationId) => getConversationTenantId(db, conversationId),
    getMessageById: (id) => getMessageById(db, id),
    getMessagesByIds: (ids) => getMessagesByIds(db, ids),
    listDeletedForUserIds: (messageIds, userId) => listDeletedForUserIds(db, messageIds, userId),
    attachQuotesToRows: (rows, opts) => attachQuotesToRows(db, rows, opts),
    getMemberLastReadSeq: (conversationId, userId) => getMemberLastReadSeq(db, conversationId, userId),
    countUnreadForConversation: (conversationId, userId) => countUnreadForConversation(db, conversationId, userId),
    listMessagesPage: (conversationId, opts) => listMessagesPage(db, conversationId, opts),
    listBlockedUserIds: (userId) => listBlockedUserIds(db, userId),
    listBlockerUserIds: (userId) => listBlockerUserIds(db, userId),
    listBlockedCounterpartIds: (userId) => listBlockedCounterpartIds(db, userId),
  };
}

export interface MessagingDistributionStore {
  getMessage(id: string): Promise<MessageRow | undefined>;
  listMembers(conversationId: string): Promise<string[]>;
  getConversation(id: string): Promise<ConversationRow | undefined>;
  getConversationTenantId(conversationId: string): Promise<string | null>;
  listBlockedCounterpartIds(userId: string): Promise<string[]>;
  attachQuotes(rows: MessageRow[], opts: { privileged: boolean; viewerId?: string }): Promise<MessageWithQuoteRow[]>;
  countUnreadForConversation(conversationId: string, userId: string): Promise<number>;
  listMessages(conversationId: string, opts?: MessageWindowOptions): Promise<MessageRow[]>;
}

export function createMessagingDistributionStore(db: MessagingDatabase): MessagingDistributionStore {
  return {
    getMessage: (id) => getMessageById(db, id),
    listMembers: (conversationId) => listConversationMemberIds(db, conversationId),
    getConversation: (id) => getConversationById(db, id),
    getConversationTenantId: (conversationId) => getConversationTenantId(db, conversationId),
    listBlockedCounterpartIds: (userId) => listBlockedCounterpartIds(db, userId),
    attachQuotes: (rows, opts) => attachQuotesToRows(db, rows, opts),
    countUnreadForConversation: (conversationId, userId) => countUnreadForConversation(db, conversationId, userId),
    listMessages: (conversationId, opts) => listMessagesPage(db, conversationId, opts),
  };
}
