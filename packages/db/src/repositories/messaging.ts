import {
  sql,
  type Expression,
  type Insertable,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { applyDefined } from './mapping';


export type MessagingDb = CentreDb | CentreTx;
export type MessagingTx = CentreTx;


export interface ConversationRow {
  id: string;
  type: number;
  name: string | null;
  component: string | null;
  itemType: string | null;
  itemId: string | null;
  contextId: string | null;
  enabled: boolean;
  createdBy: string | null;
  tenantId: string | null;
  lastMessageSeq: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  userIdFrom: string;
  subject: string;
  fullMessage: string;
  smallMessage: string;
  seq: number;
  clientMessageId: string | null;
  replyToMessageId: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  recalledAt: Date | null;
  recalledBy: string | null;
  createdAt: Date;
}

export interface NotificationRow {
  id: string;
  userIdFrom: string | null;
  userIdTo: string;
  tenantId: string | null;
  subject: string;
  fullMessage: string;
  smallMessage: string;
  component: string;
  eventType: string;
  contextUrl: string | null;
  contextUrlName: string | null;
  createdAt: Date;
  timeRead: Date | null;
}

export interface DispatchLogRow {
  id: string;
  notificationId: string | null;
  userId: string;
  tenantId: string | null;
  provider: string;
  channel: string;
  status: string;
  subject: string;
  dedupeKey: string | null;
  createdAt: Date;
}

export interface ContactRow {
  userId: string;
  contactId: string;
  createdAt: Date;
}

export interface ContactRequestRow {
  userIdFrom: string;
  userIdTo: string;
  createdAt: Date;
}

export interface ReportRow {
  id: string;
  conversationId: string;
  reporterId: string;
  reason: string;
  status: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface ModeratorActionRow {
  id: string;
  messageId: string;
  conversationId: string;
  actorId: string;
  authorId: string;
  action: string;
  reason: string | null;
  messageSeq: number | null;
  createdAt: Date;
}

export interface CourseGroupRow {
  id: string;
  courseId: string;
  name: string;
  idNumber: string;
  description: string;
  enrolmentKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummaryRow {
  conversation: ConversationRow;
  members: string[];
  lastReadSeq: number;
  unreadCount: number;
  lastMessage: MessageRow | null;
  pinnedAt: Date | null;
  archivedAt: Date | null;
  muted: boolean;
}

export interface MessageSearchOptions {
  query: string;
  limit?: number;
  privileged?: boolean;
  viewerId?: string;
  excludedAuthorIds?: string[];
}

export interface NotificationGroupAggregateRow {
  eventType: string;
  component: string;
  sourceKey: string;
  day: string;
  count: number;
  unreadCount: number;
  latestAt: Date;
  latestId: string;
}

export interface NotificationItemsOptions {
  eventType?: string;
  eventTypes?: string[];
  source?: string | null;
  day?: string;
  unreadOnly?: boolean;
  cursor?: { createdAt: Date; id: string };
  limit: number;
}

export interface MessageWindowOptions {
  beforeSeq?: number;
  afterSeq?: number;
  limit?: number;
  includeDeleted?: boolean;
  viewerId?: string;
}

export interface MessageQuoteView {
  id: string;
  seq: number;
  userIdFrom: string;
  excerpt: string;
  unavailable: boolean;
}

export type MessageWithQuoteRow = MessageRow & { replyTo: MessageQuoteView | null };

export const STAFF_ARCHETYPES = ['manager', 'coursecreator', 'editingteacher', 'teacher'] as const;


export interface MessagingStorePort {
  getConversationById(id: string): Promise<ConversationRow | undefined>;
  listConversationMemberIds(conversationId: string): Promise<string[]>;
  getConversationTenantId(conversationId: string): Promise<string | null>;
  getMessageById(id: string): Promise<MessageRow | undefined>;
  getMessagesByIds(ids: string[]): Promise<MessageRow[]>;
  listDeletedForUserIds(messageIds: string[], userId: string): Promise<Set<string>>;
  attachQuotesToRows(rows: MessageRow[], opts: { privileged: boolean; viewerId?: string }): Promise<MessageWithQuoteRow[]>;
  getMemberLastReadSeq(conversationId: string, userId: string): Promise<number | undefined>;
  countUnreadForConversation(conversationId: string, userId: string): Promise<number>;
  listMessagesPage(conversationId: string, opts?: MessageWindowOptions): Promise<MessageRow[]>;
  listBlockedUserIds(userId: string): Promise<string[]>;
  listBlockerUserIds(userId: string): Promise<string[]>;
  listBlockedCounterpartIds(userId: string): Promise<string[]>;
}


export interface NewConversation {
  id?: string;
  type?: number;
  name?: string | null;
  component?: string | null;
  itemType?: string | null;
  itemId?: string | null;
  contextId?: string | null;
  enabled?: boolean;
  createdBy?: string | null;
  tenantId?: string | null;
  lastMessageSeq?: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface NewMessage {
  id?: string;
  conversationId: string;
  userIdFrom: string;
  subject?: string;
  fullMessage?: string;
  smallMessage?: string;
  seq: number;
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  deletedAt?: Date | string | null;
  deletedBy?: string | null;
  recalledAt?: Date | string | null;
  recalledBy?: string | null;
  createdAt?: Date | string;
}

export interface NewNotification {
  id?: string;
  userIdFrom?: string | null;
  userIdTo: string;
  tenantId?: string | null;
  subject?: string;
  fullMessage?: string;
  smallMessage?: string;
  component?: string;
  eventType?: string;
  contextUrl?: string | null;
  contextUrlName?: string | null;
  createdAt?: Date | string;
  timeRead?: Date | string | null;
}

export interface NewReport {
  id?: string;
  conversationId: string;
  reporterId: string;
  reason?: string;
  status?: string;
  resolvedBy?: string | null;
  resolvedAt?: Date | string | null;
  createdAt?: Date | string;
}

export interface NewDispatchLog {
  id?: string;
  notificationId?: string | null;
  userId: string;
  tenantId?: string | null;
  provider: string;
  channel: string;
  status: string;
  subject?: string;
  dedupeKey?: string | null;
  createdAt?: Date | string;
}

export interface NewModeratorAction {
  messageId: string;
  conversationId: string;
  actorId: string;
  authorId: string;
  action: 'recall' | 'hard_delete' | 'bulk_hard_delete';
  reason?: string | null;
  messageSeq?: number | null;
}


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

const CONVERSATION_COLUMNS_QUALIFIED = [
  'message_conversations.id as id',
  'message_conversations.type as type',
  'message_conversations.name as name',
  'message_conversations.component as component',
  'message_conversations.item_type as itemType',
  'message_conversations.item_id as itemId',
  'message_conversations.context_id as contextId',
  'message_conversations.enabled as enabled',
  'message_conversations.created_by as createdBy',
  'message_conversations.tenant_id as tenantId',
  'message_conversations.last_message_seq as lastMessageSeq',
  'message_conversations.created_at as createdAt',
  'message_conversations.updated_at as updatedAt',
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

const NOTIFICATION_COLUMNS = [
  'id',
  'user_id_from as userIdFrom',
  'user_id_to as userIdTo',
  'tenant_id as tenantId',
  'subject',
  'full_message as fullMessage',
  'small_message as smallMessage',
  'component',
  'event_type as eventType',
  'context_url as contextUrl',
  'context_url_name as contextUrlName',
  'created_at as createdAt',
  'time_read as timeRead',
] as const;

const DISPATCH_LOG_COLUMNS = [
  'id',
  'notification_id as notificationId',
  'user_id as userId',
  'tenant_id as tenantId',
  'provider',
  'channel',
  'status',
  'subject',
  'dedupe_key as dedupeKey',
  'created_at as createdAt',
] as const;

const CONTACT_REQUEST_COLUMNS = [
  'user_id_from as userIdFrom',
  'user_id_to as userIdTo',
  'created_at as createdAt',
] as const;

const REPORT_COLUMNS = [
  'id',
  'conversation_id as conversationId',
  'reporter_id as reporterId',
  'reason',
  'status',
  'resolved_by as resolvedBy',
  'resolved_at as resolvedAt',
  'created_at as createdAt',
] as const;

const MODERATOR_ACTION_COLUMNS = [
  'id',
  'message_id as messageId',
  'conversation_id as conversationId',
  'actor_id as actorId',
  'author_id as authorId',
  'action',
  'reason',
  'message_seq as messageSeq',
  'created_at as createdAt',
] as const;

const COURSE_GROUP_COLUMNS = [
  'id',
  'course_id as courseId',
  'name',
  'id_number as idNumber',
  'description',
  'enrolment_key as enrolmentKey',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;


function conversationInsertValues(v: NewConversation): Insertable<CentreDB['message_conversations']> {
  const row: Insertable<CentreDB['message_conversations']> = {};
  applyDefined(row, v, [
    ['id', 'id'],
    ['type', 'type'],
    ['name', 'name'],
    ['component', 'component'],
    ['itemType', 'item_type'],
    ['itemId', 'item_id'],
    ['contextId', 'context_id'],
    ['enabled', 'enabled'],
    ['createdBy', 'created_by'],
    ['tenantId', 'tenant_id'],
    ['lastMessageSeq', 'last_message_seq'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function messageInsertValues(v: NewMessage): Insertable<CentreDB['message']> {
  const row: Insertable<CentreDB['message']> = {
    conversation_id: v.conversationId,
    user_id_from: v.userIdFrom,
    seq: v.seq,
  };
  applyDefined(row, v, [
    ['id', 'id'],
    ['subject', 'subject'],
    ['fullMessage', 'full_message'],
    ['smallMessage', 'small_message'],
    ['clientMessageId', 'client_message_id'],
    ['replyToMessageId', 'reply_to_message_id'],
    ['deletedAt', 'deleted_at'],
    ['deletedBy', 'deleted_by'],
    ['recalledAt', 'recalled_at'],
    ['recalledBy', 'recalled_by'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function notificationInsertValues(v: NewNotification): Insertable<CentreDB['notifications']> {
  const row: Insertable<CentreDB['notifications']> = {
    user_id_to: v.userIdTo,
  };
  applyDefined(row, v, [
    ['id', 'id'],
    ['userIdFrom', 'user_id_from'],
    ['tenantId', 'tenant_id'],
    ['subject', 'subject'],
    ['fullMessage', 'full_message'],
    ['smallMessage', 'small_message'],
    ['component', 'component'],
    ['eventType', 'event_type'],
    ['contextUrl', 'context_url'],
    ['contextUrlName', 'context_url_name'],
    ['createdAt', 'created_at'],
    ['timeRead', 'time_read'],
  ]);
  return row;
}

function reportInsertValues(v: NewReport): Insertable<CentreDB['message_conversation_reports']> {
  const row: Insertable<CentreDB['message_conversation_reports']> = {
    conversation_id: v.conversationId,
    reporter_id: v.reporterId,
  };
  applyDefined(row, v, [
    ['id', 'id'],
    ['reason', 'reason'],
    ['status', 'status'],
    ['resolvedBy', 'resolved_by'],
    ['resolvedAt', 'resolved_at'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function dispatchLogInsertValues(v: NewDispatchLog): Insertable<CentreDB['notification_dispatch_log']> {
  const row: Insertable<CentreDB['notification_dispatch_log']> = {
    user_id: v.userId,
    provider: v.provider,
    channel: v.channel,
    status: v.status,
  };
  applyDefined(row, v, [
    ['id', 'id'],
    ['notificationId', 'notification_id'],
    ['tenantId', 'tenant_id'],
    ['subject', 'subject'],
    ['dedupeKey', 'dedupe_key'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}


export class MessagingRepository {
  constructor(
    private readonly handle: CentreDb,
    private readonly store: MessagingStorePort,
  ) {}

  async transaction<T>(fn: (tx: MessagingTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  async insertConversation(v: NewConversation, tx?: MessagingDb): Promise<ConversationRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('message_conversations')
      .values(conversationInsertValues(v))
      .returning(CONVERSATION_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<ConversationRow>;
  }
  async getConversation(id: string): Promise<ConversationRow | undefined> {
    return this.store.getConversationById(id);
  }
  async addMember(conversationId: string, userId: string, tx?: MessagingDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .insertInto('message_conversation_members')
      .values({ conversation_id: conversationId, user_id: userId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  async removeMember(conversationId: string, userId: string): Promise<void> {
    await this.handle
      .deleteFrom('message_conversation_members')
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .execute();
  }
  async listMembers(conversationId: string): Promise<string[]> {
    return this.store.listConversationMemberIds(conversationId);
  }
  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const rows = await this.handle
      .selectFrom('message_conversation_members')
      .select('user_id')
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .execute();
    return rows.length > 0;
  }
  async listConversationsForUser(userId: string): Promise<ConversationRow[]> {
    return this.handle
      .selectFrom('message_conversation_members')
      .innerJoin('message_conversations', 'message_conversations.id', 'message_conversation_members.conversation_id')
      .select(CONVERSATION_COLUMNS_QUALIFIED)
      .where('message_conversation_members.user_id', '=', userId)
      .orderBy('message_conversations.updated_at', 'desc')
      .execute() as Promise<ConversationRow[]>;
  }
  async listConversationSummaries(userId: string, opts: { archivedOnly?: boolean } = {}): Promise<ConversationSummaryRow[]> {
    const archivedClause = opts.archivedOnly
      ? sql`AND mine.archived_at IS NOT NULL`
      : sql`AND mine.archived_at IS NULL`;
    const executed = await sql<Record<string, unknown>>`
      SELECT c.id AS conversation_id, c.type AS conversation_type, c.name AS conversation_name,
        c.component AS conversation_component, c.item_type AS conversation_item_type,
        c.item_id AS conversation_item_id, c.context_id AS conversation_context_id,
        c.enabled AS conversation_enabled, c.created_by AS conversation_created_by,
        c.tenant_id AS conversation_tenant_id,
        c.last_message_seq AS conversation_last_seq,
        c.created_at AS conversation_created_at, c.updated_at AS conversation_updated_at,
        mine.last_read_seq AS last_read_seq,
        mine.pinned_at AS pinned_at, mine.archived_at AS archived_at, mine.muted AS muted,
        COALESCE(mem.members, ARRAY[]::uuid[]) AS members,
        COALESCE(u.unread, 0)::int AS unread_count,
        lm.last_message AS last_message
      FROM message_conversation_members mine
      JOIN message_conversations c ON c.id = mine.conversation_id
      LEFT JOIN LATERAL (
        SELECT array_agg(user_id ORDER BY created_at, user_id) AS members
        FROM message_conversation_members WHERE conversation_id = c.id
      ) mem ON true
      LEFT JOIN LATERAL (
        SELECT CASE WHEN mine.muted THEN 0 ELSE count(*) END AS unread FROM message msg
        WHERE msg.conversation_id = c.id AND msg.seq > mine.last_read_seq AND msg.user_id_from <> mine.user_id
          AND msg.deleted_at IS NULL
          AND msg.recalled_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM message_user_deletions d
            WHERE d.message_id = msg.id AND d.user_id = mine.user_id
          )
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT to_jsonb(msg) AS last_message FROM message msg
        WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM message_user_deletions d
            WHERE d.message_id = msg.id AND d.user_id = mine.user_id
          )
        ORDER BY msg.seq DESC LIMIT 1
      ) lm ON true
      WHERE mine.user_id = ${userId}
        ${archivedClause}
        AND NOT (c.type = 1 AND EXISTS (
          SELECT 1 FROM message_conversation_members other_m
          JOIN message_users_blocked b
            ON (b.user_id = mine.user_id AND b.blocked_user_id = other_m.user_id)
            OR (b.user_id = other_m.user_id AND b.blocked_user_id = mine.user_id)
          WHERE other_m.conversation_id = c.id AND other_m.user_id <> mine.user_id
        ))
      ORDER BY (mine.pinned_at IS NOT NULL) DESC, c.updated_at DESC
    `.execute(this.handle);
    return executed.rows.map((raw) => {
      const lastMessageRaw = raw.last_message as Record<string, unknown> | null;
      return {
        conversation: {
          id: raw.conversation_id as string,
          type: raw.conversation_type as number,
          name: raw.conversation_name as string | null,
          component: raw.conversation_component as string | null,
          itemType: raw.conversation_item_type as string | null,
          itemId: raw.conversation_item_id as string | null,
          contextId: raw.conversation_context_id as string | null,
          enabled: raw.conversation_enabled as boolean,
          createdBy: (raw.conversation_created_by as string | null) ?? null,
          tenantId: (raw.conversation_tenant_id as string | null) ?? null,
          lastMessageSeq: raw.conversation_last_seq as number,
          createdAt: new Date(raw.conversation_created_at as string),
          updatedAt: new Date(raw.conversation_updated_at as string),
        },
        members: (raw.members as string[]) ?? [],
        lastReadSeq: raw.last_read_seq as number,
        unreadCount: raw.unread_count as number,
        pinnedAt: raw.pinned_at ? new Date(raw.pinned_at as string) : null,
        archivedAt: raw.archived_at ? new Date(raw.archived_at as string) : null,
        muted: raw.muted === true,
        lastMessage: lastMessageRaw
          ? {
              id: lastMessageRaw.id as string,
              conversationId: lastMessageRaw.conversation_id as string,
              userIdFrom: lastMessageRaw.user_id_from as string,
              subject: lastMessageRaw.subject as string,
              fullMessage: lastMessageRaw.full_message as string,
              smallMessage: lastMessageRaw.small_message as string,
              seq: lastMessageRaw.seq as number,
              clientMessageId: (lastMessageRaw.client_message_id as string | null) ?? null,
              replyToMessageId: (lastMessageRaw.reply_to_message_id as string | null) ?? null,
              deletedAt: lastMessageRaw.deleted_at ? new Date(lastMessageRaw.deleted_at as string) : null,
              deletedBy: (lastMessageRaw.deleted_by as string | null) ?? null,
              recalledAt: lastMessageRaw.recalled_at ? new Date(lastMessageRaw.recalled_at as string) : null,
              recalledBy: (lastMessageRaw.recalled_by as string | null) ?? null,
              createdAt: new Date(lastMessageRaw.created_at as string),
            }
          : null,
      };
    });
  }
  async findIndividualConversation(a: string, b: string): Promise<ConversationRow | undefined> {
    const mine = await this.listConversationsForUser(a);
    for (const c of mine) {
      if (c.type !== 1) continue;
      const members = await this.listMembers(c.id);
      if (members.length === 2 && members.includes(b)) return c;
    }
    return undefined;
  }
  async allocateNextSeq(conversationId: string, tx: MessagingTx): Promise<number> {
    const row = await tx
      .updateTable('message_conversations')
      .set({ last_message_seq: sql<number>`last_message_seq + 1`, updated_at: new Date() })
      .where('id', '=', conversationId)
      .returning('last_message_seq as seq')
      .executeTakeFirstOrThrow();
    return row.seq;
  }

  async insertMessage(v: NewMessage, tx?: MessagingDb): Promise<MessageRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('message')
      .values(messageInsertValues(v))
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<MessageRow>;
  }
  async getMessage(id: string): Promise<MessageRow | undefined> {
    return this.store.getMessageById(id);
  }
  async getMessageByClientId(conversationId: string, userIdFrom: string, clientMessageId: string): Promise<MessageRow | undefined> {
    return this.handle
      .selectFrom('message')
      .select(MESSAGE_COLUMNS)
      .where('conversation_id', '=', conversationId)
      .where('user_id_from', '=', userIdFrom)
      .where('client_message_id', '=', clientMessageId)
      .executeTakeFirst() as Promise<MessageRow | undefined>;
  }
  async listMessages(conversationId: string, opts: MessageWindowOptions = {}): Promise<MessageRow[]> {
    return this.store.listMessagesPage(conversationId, opts);
  }
  async searchMessages(conversationId: string, opts: MessageSearchOptions): Promise<MessageRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const escaped = opts.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const pattern = `%${escaped}%`;
    return this.handle
      .selectFrom('message')
      .select(MESSAGE_COLUMNS)
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('conversation_id', '=', conversationId),
          sql<SqlBool>`full_message ilike ${pattern}`,
        ];
        if (!opts.privileged) {
          conds.push(eb('deleted_at', 'is', null));
          conds.push(eb('recalled_at', 'is', null));
          if (opts.viewerId) {
            const viewerId = opts.viewerId;
            conds.push(sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${viewerId})`);
          }
          if (opts.excludedAuthorIds && opts.excludedAuthorIds.length > 0) {
            conds.push(eb('user_id_from', 'not in', opts.excludedAuthorIds));
          }
        }
        return eb.and(conds);
      })
      .orderBy('seq', 'desc')
      .limit(limit)
      .execute() as Promise<MessageRow[]>;
  }
  async hasMessagesBefore(conversationId: string, seq: number, includeDeleted = false, viewerId?: string): Promise<boolean> {
    const row = await this.handle
      .selectFrom('message')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('conversation_id', '=', conversationId),
          eb('seq', '<', seq),
        ];
        if (!includeDeleted) conds.push(eb('deleted_at', 'is', null));
        if (viewerId && !includeDeleted) {
          conds.push(sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${viewerId})`);
        }
        return eb.and(conds);
      })
      .executeTakeFirst();
    return (row?.value ?? 0) > 0;
  }
  async softDeleteMessage(id: string, deletedBy: string): Promise<MessageRow | undefined> {
    return this.handle
      .updateTable('message')
      .set({ deleted_at: new Date(), deleted_by: deletedBy })
      .where('id', '=', id)
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirst() as Promise<MessageRow | undefined>;
  }
  async markDeletedForUser(messageId: string, userId: string): Promise<void> {
    await this.handle
      .insertInto('message_user_deletions')
      .values({ message_id: messageId, user_id: userId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  async isDeletedForUser(messageId: string, userId: string): Promise<boolean> {
    const rows = await this.handle
      .selectFrom('message_user_deletions')
      .select('message_id as messageId')
      .where('message_id', '=', messageId)
      .where('user_id', '=', userId)
      .limit(1)
      .execute();
    return rows.length > 0;
  }
  async applyRecall(id: string, recalledBy: string): Promise<MessageRow | undefined> {
    return this.handle
      .updateTable('message')
      .set({ recalled_at: new Date(), recalled_by: recalledBy })
      .where('id', '=', id)
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirst() as Promise<MessageRow | undefined>;
  }
  async hardDeleteMessage(id: string): Promise<void> {
    await this.handle.deleteFrom('message').where('id', '=', id).execute();
  }
  async getMessagesByIds(ids: string[]): Promise<MessageRow[]> {
    return this.store.getMessagesByIds(ids);
  }
  async listDeletedForUserIds(messageIds: string[], userId: string): Promise<Set<string>> {
    return this.store.listDeletedForUserIds(messageIds, userId);
  }
  async attachQuotes(rows: MessageRow[], opts: { privileged: boolean; viewerId?: string }): Promise<MessageWithQuoteRow[]> {
    return this.store.attachQuotesToRows(rows, opts);
  }
  async insertModeratorAction(values: NewModeratorAction): Promise<void> {
    await this.handle
      .insertInto('message_moderator_actions')
      .values({
        message_id: values.messageId,
        conversation_id: values.conversationId,
        actor_id: values.actorId,
        author_id: values.authorId,
        action: values.action,
        reason: values.reason ?? null,
        message_seq: values.messageSeq ?? null,
      })
      .execute();
  }
  async listModeratorActionsForMessage(messageId: string): Promise<ModeratorActionRow[]> {
    return this.handle
      .selectFrom('message_moderator_actions')
      .select(MODERATOR_ACTION_COLUMNS)
      .where('message_id', '=', messageId)
      .orderBy('created_at', 'asc')
      .execute() as Promise<ModeratorActionRow[]>;
  }
  async setConversationEnabled(id: string, enabled: boolean): Promise<ConversationRow | undefined> {
    return this.handle
      .updateTable('message_conversations')
      .set({ enabled, updated_at: new Date() })
      .where('id', '=', id)
      .returning(CONVERSATION_COLUMNS)
      .executeTakeFirst() as Promise<ConversationRow | undefined>;
  }
  async getMemberLastReadSeq(conversationId: string, userId: string): Promise<number | undefined> {
    return this.store.getMemberLastReadSeq(conversationId, userId);
  }
  async listMemberReadMarkers(conversationId: string): Promise<{ userId: string; lastReadSeq: number }[]> {
    return this.handle
      .selectFrom('message_conversation_members')
      .select(['user_id as userId', 'last_read_seq as lastReadSeq'])
      .where('conversation_id', '=', conversationId)
      .execute();
  }
  async getMemberConversationState(conversationId: string, userId: string): Promise<{ pinnedAt: Date | null; archivedAt: Date | null; muted: boolean } | undefined> {
    return this.handle
      .selectFrom('message_conversation_members')
      .select(['pinned_at as pinnedAt', 'archived_at as archivedAt', 'muted'])
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }
  async updateMemberConversationState(
    conversationId: string,
    userId: string,
    patch: { pinned?: boolean; archived?: boolean; muted?: boolean },
  ): Promise<{ pinnedAt: Date | null; archivedAt: Date | null; muted: boolean } | undefined> {
    const set: { pinned_at?: Date | null; archived_at?: Date | null; muted?: boolean } = {};
    if (patch.pinned !== undefined) set.pinned_at = patch.pinned ? new Date() : null;
    if (patch.archived !== undefined) set.archived_at = patch.archived ? new Date() : null;
    if (patch.muted !== undefined) set.muted = patch.muted;
    if (Object.keys(set).length === 0) return this.getMemberConversationState(conversationId, userId);
    return this.handle
      .updateTable('message_conversation_members')
      .set(set)
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .returning(['pinned_at as pinnedAt', 'archived_at as archivedAt', 'muted'])
      .executeTakeFirst();
  }
  async listMutedMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.handle
      .selectFrom('message_conversation_members')
      .select('user_id as userId')
      .where('conversation_id', '=', conversationId)
      .where('muted', '=', true)
      .execute();
    return rows.map((r) => r.userId);
  }
  async clearArchivedForIncomingMessage(conversationId: string, senderId: string, tx?: MessagingDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .updateTable('message_conversation_members')
      .set({ archived_at: null })
      .where('conversation_id', '=', conversationId)
      .where('user_id', '<>', senderId)
      .where('archived_at', 'is not', null)
      .execute();
  }
  async markConversationRead(conversationId: string, readerId: string): Promise<{ marked: number; lastReadSeq: number }> {
    const member = await this.handle
      .selectFrom('message_conversation_members')
      .select(['conversation_id as conversationId', 'user_id as userId', 'last_read_seq as lastReadSeq', 'pinned_at as pinnedAt', 'archived_at as archivedAt', 'muted', 'created_at as createdAt'])
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', readerId)
      .executeTakeFirst();
    if (!member) return { marked: 0, lastReadSeq: 0 };
    const conversation = await this.handle
      .selectFrom('message_conversations')
      .select('last_message_seq as lastMessageSeq')
      .where('id', '=', conversationId)
      .executeTakeFirst();
    const target = conversation?.lastMessageSeq ?? member.lastReadSeq;
    const unread = await this.handle
      .selectFrom('message')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => eb.and([
        eb('conversation_id', '=', conversationId),
        eb('seq', '>', member.lastReadSeq),
        eb('seq', '<=', target),
        eb('user_id_from', '<>', readerId),
        eb('deleted_at', 'is', null),
        eb('recalled_at', 'is', null),
        sql<SqlBool>`not exists (select 1 from message_user_deletions d where d.message_id = message.id and d.user_id = ${readerId})`,
      ]))
      .executeTakeFirst();
    if (target > member.lastReadSeq) {
      await this.handle
        .updateTable('message_conversation_members')
        .set({ last_read_seq: target })
        .where('conversation_id', '=', conversationId)
        .where('user_id', '=', readerId)
        .execute();
    }
    return { marked: unread?.value ?? 0, lastReadSeq: target };
  }
  async countUnreadForConversation(conversationId: string, userId: string): Promise<number> {
    return this.store.countUnreadForConversation(conversationId, userId);
  }
  async countUnreadConversations(userId: string): Promise<number> {
    const row = await this.handle
      .selectFrom('message_conversation_members')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => eb.and([
        eb('user_id', '=', userId),
        eb('muted', '=', false),
        sql<SqlBool>`exists (
          select 1 from message msg
          where msg.conversation_id = message_conversation_members.conversation_id
            and msg.seq > message_conversation_members.last_read_seq
            and msg.user_id_from <> ${userId}
            and msg.deleted_at is null
            and msg.recalled_at is null
            and not exists (
              select 1 from message_user_deletions d
              where d.message_id = msg.id and d.user_id = ${userId}
            )
        )`,
        sql<SqlBool>`not exists (
          select 1 from message_conversations c
          join message_conversation_members other_m
            on other_m.conversation_id = c.id and other_m.user_id <> ${userId}
          join message_users_blocked b
            on (b.user_id = ${userId} and b.blocked_user_id = other_m.user_id)
            or (b.user_id = other_m.user_id and b.blocked_user_id = ${userId})
          where c.id = message_conversation_members.conversation_id and c.type = 1
        )`,
      ]))
      .executeTakeFirst();
    return row?.value ?? 0;
  }

  async block(userId: string, blockedUserId: string): Promise<void> {
    await this.handle
      .insertInto('message_users_blocked')
      .values({ user_id: userId, blocked_user_id: blockedUserId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  async unblock(userId: string, blockedUserId: string): Promise<void> {
    await this.handle
      .deleteFrom('message_users_blocked')
      .where('user_id', '=', userId)
      .where('blocked_user_id', '=', blockedUserId)
      .execute();
  }
  async isBlocked(userId: string, blockedUserId: string): Promise<boolean> {
    const rows = await this.handle
      .selectFrom('message_users_blocked')
      .select('user_id')
      .where('user_id', '=', userId)
      .where('blocked_user_id', '=', blockedUserId)
      .execute();
    return rows.length > 0;
  }
  async listBlocked(userId: string): Promise<string[]> {
    return this.store.listBlockedUserIds(userId);
  }
  async listBlockerIds(userId: string): Promise<string[]> {
    return this.store.listBlockerUserIds(userId);
  }
  async listBlockedCounterpartIds(userId: string): Promise<string[]> {
    return this.store.listBlockedCounterpartIds(userId);
  }

  async sharesConversation(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    const row = await this.handle
      .selectFrom('message_conversation_members')
      .innerJoin('message_conversations', 'message_conversations.id', 'message_conversation_members.conversation_id')
      .select(sql<number>`1`.as('value'))
      .where((eb) => eb.and([
        eb('message_conversation_members.user_id', '=', viewerId),
        sql<SqlBool>`exists (
          select 1 from message_conversation_members other_m
          where other_m.conversation_id = message_conversation_members.conversation_id
            and other_m.user_id = ${targetId}
        )`,
        sql<SqlBool>`not (
          message_conversations.type = 1 and exists (
            select 1 from message_users_blocked b
            where (b.user_id = ${viewerId} and b.blocked_user_id = ${targetId})
               or (b.user_id = ${targetId} and b.blocked_user_id = ${viewerId})
          )
        )`,
      ]))
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async sharesDirectConversation(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    const row = await this.handle
      .selectFrom('message_conversation_members')
      .innerJoin('message_conversations', 'message_conversations.id', 'message_conversation_members.conversation_id')
      .select(sql<number>`1`.as('value'))
      .where((eb) => eb.and([
        eb('message_conversation_members.user_id', '=', viewerId),
        eb('message_conversations.type', '=', 1),
        sql<SqlBool>`exists (
          select 1 from message_conversation_members other_m
          where other_m.conversation_id = message_conversation_members.conversation_id
            and other_m.user_id = ${targetId}
        )`,
        sql<SqlBool>`not (exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${viewerId} and b.blocked_user_id = ${targetId})
             or (b.user_id = ${targetId} and b.blocked_user_id = ${viewerId})
        ))`,
      ]))
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }


  async addContactPair(a: string, b: string): Promise<void> {
    await this.handle
      .insertInto('message_contacts')
      .values([
        { user_id: a, contact_id: b },
        { user_id: b, contact_id: a },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  async removeContactPair(a: string, b: string): Promise<void> {
    await this.handle
      .deleteFrom('message_contacts')
      .where((eb) => eb.or([
        eb.and([eb('user_id', '=', a), eb('contact_id', '=', b)]),
        eb.and([eb('user_id', '=', b), eb('contact_id', '=', a)]),
      ]))
      .execute();
    await this.deleteContactRequestsBetween(a, b);
  }
  async listContacts(userId: string): Promise<string[]> {
    const rows = await this.handle
      .selectFrom('message_contacts')
      .select('contact_id as contactId')
      .where((eb) => eb.and([
        eb('user_id', '=', userId),
        sql<SqlBool>`not exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${userId} and b.blocked_user_id = message_contacts.contact_id)
             or (b.user_id = message_contacts.contact_id and b.blocked_user_id = ${userId})
        )`,
      ]))
      .execute();
    return rows.map((r) => r.contactId);
  }
  async isContact(ownerId: string, contactId: string): Promise<boolean> {
    const rows = await this.handle
      .selectFrom('message_contacts')
      .select('user_id')
      .where('user_id', '=', ownerId)
      .where('contact_id', '=', contactId)
      .execute();
    return rows.length > 0;
  }
  async createContactRequest(fromId: string, toId: string): Promise<void> {
    await this.handle
      .insertInto('message_contact_requests')
      .values({ user_id_from: fromId, user_id_to: toId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  async getContactRequest(fromId: string, toId: string): Promise<ContactRequestRow | undefined> {
    return this.handle
      .selectFrom('message_contact_requests')
      .select(CONTACT_REQUEST_COLUMNS)
      .where('user_id_from', '=', fromId)
      .where('user_id_to', '=', toId)
      .executeTakeFirst() as Promise<ContactRequestRow | undefined>;
  }
  async deleteContactRequest(fromId: string, toId: string): Promise<void> {
    await this.handle
      .deleteFrom('message_contact_requests')
      .where('user_id_from', '=', fromId)
      .where('user_id_to', '=', toId)
      .execute();
  }
  async deleteContactRequestsBetween(a: string, b: string): Promise<void> {
    await this.handle
      .deleteFrom('message_contact_requests')
      .where((eb) => eb.or([
        eb.and([eb('user_id_from', '=', a), eb('user_id_to', '=', b)]),
        eb.and([eb('user_id_from', '=', b), eb('user_id_to', '=', a)]),
      ]))
      .execute();
  }
  async listIncomingContactRequests(userId: string): Promise<ContactRequestRow[]> {
    return this.handle
      .selectFrom('message_contact_requests')
      .select(CONTACT_REQUEST_COLUMNS)
      .where('user_id_to', '=', userId)
      .orderBy('created_at', 'asc')
      .execute() as Promise<ContactRequestRow[]>;
  }
  async listOutgoingContactRequests(userId: string): Promise<ContactRequestRow[]> {
    return this.handle
      .selectFrom('message_contact_requests')
      .select(CONTACT_REQUEST_COLUMNS)
      .where('user_id_from', '=', userId)
      .orderBy('created_at', 'asc')
      .execute() as Promise<ContactRequestRow[]>;
  }


  async hasStaffRoleAssignment(userId: string): Promise<boolean> {
    const rows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  async hasStudentContext(userId: string): Promise<boolean> {
    const now = new Date();
    const enrolled = await this.handle
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.id as id')
      .where((eb) => eb.and([
        eb('user_enrolments.user_id', '=', userId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .limit(1)
      .execute();
    if (enrolled.length > 0) return true;
    const assigned = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', '=', 'student')
      .limit(1)
      .execute();
    return assigned.length > 0;
  }

  async hasActiveGuardianLink(userId: string): Promise<boolean> {
    const rows = await this.handle
      .selectFrom('guardian_links')
      .select('id')
      .where('guardian_user_id', '=', userId)
      .where('status', '=', 'active')
      .limit(1)
      .execute();
    return rows.length > 0;
  }
  async listCourseStaffUserIds(courseId: string): Promise<string[]> {
    const courseCtx = await this.handle
      .selectFrom('context')
      .select(['id', 'path'])
      .where('context_level', '=', 50)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseCtx) return [];
    const pathIds = courseCtx.path.split('/').filter((part) => part.length > 0);
    if (!pathIds.length) return [];
    const rows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.user_id as userId')
      .distinct()
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .where('role_assignments.context_id', 'in', pathIds)
      .execute();
    return rows.map((r) => r.userId);
  }


  async insertReport(v: NewReport): Promise<ReportRow> {
    return this.handle
      .insertInto('message_conversation_reports')
      .values(reportInsertValues(v))
      .returning(REPORT_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<ReportRow>;
  }
  async getReport(id: string): Promise<ReportRow | undefined> {
    return this.handle
      .selectFrom('message_conversation_reports')
      .select(REPORT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<ReportRow | undefined>;
  }
  async listReports(limit = 200): Promise<ReportRow[]> {
    return this.handle
      .selectFrom('message_conversation_reports')
      .select(REPORT_COLUMNS)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute() as Promise<ReportRow[]>;
  }
  async updateReportStatus(id: string, status: string, resolvedBy: string | null): Promise<ReportRow | undefined> {
    const closing = status !== 'open';
    return this.handle
      .updateTable('message_conversation_reports')
      .set({
        status,
        resolved_by: closing ? resolvedBy : null,
        resolved_at: closing ? new Date() : null,
      })
      .where('id', '=', id)
      .returning(REPORT_COLUMNS)
      .executeTakeFirst() as Promise<ReportRow | undefined>;
  }


  async activeCourseIds(userId: string): Promise<string[]> {
    const now = new Date();
    const rows = await this.handle
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('enrol.course_id as courseId')
      .where((eb) => eb.and([
        eb('user_enrolments.user_id', '=', userId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .execute();
    return rows.map((r) => r.courseId);
  }
  async findTeacherStudentSharedCourseId(userA: string, userB: string): Promise<string | null> {
    const now = new Date();
    const rows = await this.handle
      .selectFrom('context')
      .innerJoin('role_assignments', 'role_assignments.context_id', 'context.id')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('enrol', 'enrol.course_id', 'context.instance_id')
      .innerJoin('user_enrolments', 'user_enrolments.enrol_id', 'enrol.id')
      .select('context.instance_id as courseId')
      .where((eb) => eb.and([
        eb('context.context_level', '=', 50),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
        eb.or([
          eb.and([eb('role_assignments.user_id', '=', userA), eb('user_enrolments.user_id', '=', userB)]),
          eb.and([eb('role_assignments.user_id', '=', userB), eb('user_enrolments.user_id', '=', userA)]),
        ]),
      ]))
      .limit(1)
      .execute();
    return rows[0]?.courseId ?? null;
  }
  async isCourseTeachingStaff(courseId: string, userId: string): Promise<boolean> {
    const courseCtx = await this.handle
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', 50)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseCtx) return false;
    const rows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.context_id', '=', courseCtx.id)
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }
  async getCourseSummary(courseId: string): Promise<{ courseId: string; fullName: string; shortName: string } | undefined> {
    return this.handle
      .selectFrom('course')
      .select(['id as courseId', 'full_name as fullName', 'short_name as shortName'])
      .where('id', '=', courseId)
      .executeTakeFirst();
  }
  async listMembershipCourseIds(userId: string): Promise<string[]> {
    const enrolled = await this.activeCourseIds(userId);
    const assigned = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .select('context.instance_id as courseId')
      .distinct()
      .where('role_assignments.user_id', '=', userId)
      .where('context.context_level', '=', 50)
      .execute();
    const assignedCourseIds = assigned.map((r) => r.courseId).filter((id): id is string => id !== null);
    return [...new Set([...enrolled, ...assignedCourseIds])];
  }
  async isCourseMember(courseId: string, userId: string): Promise<boolean> {
    const now = new Date();
    const enrolled = await this.handle
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.user_id as userId')
      .where((eb) => eb.and([
        eb('enrol.course_id', '=', courseId),
        eb('user_enrolments.user_id', '=', userId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .limit(1)
      .executeTakeFirst();
    if (enrolled) return true;
    const courseCtx = await this.handle
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', 50)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseCtx) return false;
    const assigned = await this.handle
      .selectFrom('role_assignments')
      .select('id')
      .where('context_id', '=', courseCtx.id)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return Boolean(assigned);
  }
  async listCourseRosterPage(courseId: string, actorId: string, cursor: { displayName: string; username: string; userId: string } | null, limit: number): Promise<{
    userId: string; username: string; firstName: string; lastName: string; displayName: string; staff: boolean; enrolled: boolean;
  }[]> {
    const cursorCond = cursor
      ? sql`and ((case when btrim(u.first_name || ' ' || u.last_name) = '' then u.username else btrim(u.first_name || ' ' || u.last_name) end), u.username, u.id) > (${cursor.displayName}, ${cursor.username}, ${cursor.userId}::uuid)`
      : sql``;
    const executed = await sql<Record<string, unknown>>`
      with course_ctx as (
        select id from "context" where context_level = 50 and instance_id = ${courseId}
      ),
      member_flags as (
        select ue.user_id as user_id, false as staff, true as enrolled
        from user_enrolments ue
        join enrol e on e.id = ue.enrol_id
        where e.course_id = ${courseId}
          and ue.status = 0 and e.status = 0
          and ue.time_start <= now() and (ue.time_end is null or ue.time_end >= now())
        union all
        select ra.user_id as user_id, (r.archetype in ('manager', 'coursecreator', 'editingteacher', 'teacher')) as staff, false as enrolled
        from role_assignments ra
        join role r on r.id = ra.role_id
        where ra.context_id = (select id from course_ctx)
      ),
      members as (
        select user_id, bool_or(staff) as staff, bool_or(enrolled) as enrolled from member_flags group by user_id
      )
      select u.id as user_id, u.username as username, u.first_name as first_name, u.last_name as last_name,
        (case when btrim(u.first_name || ' ' || u.last_name) = '' then u.username else btrim(u.first_name || ' ' || u.last_name) end) as display_name,
        m.staff as staff, m.enrolled as enrolled
      from members m
      join users u on u.id = m.user_id
      where u.deleted = false and u.suspended = false and u.is_guest = false
        and u.id <> ${actorId}
        and not exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${actorId} and b.blocked_user_id = u.id)
             or (b.user_id = u.id and b.blocked_user_id = ${actorId})
        )
        ${cursorCond}
      order by display_name asc, u.username asc, u.id asc
      limit ${limit}
    `.execute(this.handle);
    return executed.rows.map((raw) => ({
      userId: raw.user_id as string,
      username: raw.username as string,
      firstName: raw.first_name as string,
      lastName: raw.last_name as string,
      displayName: raw.display_name as string,
      staff: Boolean(raw.staff),
      enrolled: Boolean(raw.enrolled),
    }));
  }


  async getCourseGroup(groupId: string): Promise<CourseGroupRow | undefined> {
    return this.handle
      .selectFrom('course_groups')
      .select(COURSE_GROUP_COLUMNS)
      .where('id', '=', groupId)
      .executeTakeFirst() as Promise<CourseGroupRow | undefined>;
  }
  async listGroupMemberIds(groupId: string): Promise<string[]> {
    const rows = await this.handle
      .selectFrom('groups_members')
      .select('user_id as userId')
      .where('group_id', '=', groupId)
      .execute();
    return rows.map((r) => r.userId);
  }
  async listGroupIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.handle
      .selectFrom('groups_members')
      .select('group_id as groupId')
      .where('user_id', '=', userId)
      .execute();
    return rows.map((r) => r.groupId);
  }
  async findGroupConversation(groupId: string): Promise<ConversationRow | undefined> {
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_group')
      .where('item_type', '=', 'groups')
      .where('item_id', '=', groupId)
      .executeTakeFirst() as Promise<ConversationRow | undefined>;
  }
  async listGroupConversationsForGroupMember(userId: string): Promise<ConversationRow[]> {
    const memberships = await this.handle
      .selectFrom('groups_members')
      .select('group_id as groupId')
      .where('user_id', '=', userId)
      .execute();
    if (!memberships.length) return [];
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_group')
      .where('item_type', '=', 'groups')
      .where('item_id', 'in', memberships.map((m) => m.groupId))
      .execute() as Promise<ConversationRow[]>;
  }


  async findCourseConversation(courseId: string, tx?: MessagingDb): Promise<ConversationRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_course')
      .where('item_type', '=', 'course')
      .where('item_id', '=', courseId)
      .executeTakeFirst() as Promise<ConversationRow | undefined>;
  }
  async acquireCourseConversationLock(tx: MessagingTx, courseId: string): Promise<void> {
    const key = `messaging:core_course:${courseId}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx);
  }
  async listActiveEnrolledUserIds(courseId: string): Promise<string[]> {
    const now = new Date();
    const rows = await this.handle
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.user_id as userId')
      .where((eb) => eb.and([
        eb('enrol.course_id', '=', courseId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .execute();
    return [...new Set(rows.map((r) => r.userId))];
  }
  async listCourseConversationMemberIds(courseId: string): Promise<string[]> {
    const enrolled = await this.listActiveEnrolledUserIds(courseId);
    const staff = await this.listCourseStaffUserIds(courseId);
    return [...new Set([...enrolled, ...staff])];
  }
  async listCourseConversationsForMember(userId: string): Promise<ConversationRow[]> {
    const courseIds = await this.listMembershipCourseIds(userId);
    if (!courseIds.length) return [];
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_course')
      .where('item_type', '=', 'course')
      .where('item_id', 'in', courseIds)
      .execute() as Promise<ConversationRow[]>;
  }


  async getClassSummary(classId: string): Promise<{ classId: string; name: string; ownerId: string; cohortId: string; tenantId: string; status: string } | undefined> {
    return this.handle
      .selectFrom('classes')
      .select(['id as classId', 'name', 'owner_id as ownerId', 'cohort_id as cohortId', 'tenant_id as tenantId', 'status'])
      .where('id', '=', classId)
      .executeTakeFirst();
  }
  async listClassStaffUserIds(classId: string): Promise<string[]> {
    const classCtx = await this.handle
      .selectFrom('context')
      .select(['id', 'path'])
      .where('context_level', '=', 45)
      .where('instance_id', '=', classId)
      .executeTakeFirst();
    if (!classCtx) return [];
    const pathIds = classCtx.path.split('/').filter((part) => part.length > 0);
    if (!pathIds.length) return [];
    const rows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.user_id as userId')
      .distinct()
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .where('role_assignments.context_id', 'in', pathIds)
      .execute();
    return rows.map((r) => r.userId);
  }
  async isClassTeachingStaff(classId: string, userId: string): Promise<boolean> {
    const classCtx = await this.handle
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', 45)
      .where('instance_id', '=', classId)
      .executeTakeFirst();
    if (!classCtx) return false;
    const rows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.context_id', '=', classCtx.id)
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }
  async listClassRosterMemberIds(classId: string): Promise<string[]> {
    const cls = await this.getClassSummary(classId);
    if (!cls) return [];
    const rows = await this.handle
      .selectFrom('cohort_members')
      .select('user_id as userId')
      .where('cohort_id', '=', cls.cohortId)
      .execute();
    return rows.map((r) => r.userId);
  }
  async listClassConversationMemberIds(classId: string): Promise<string[]> {
    const cls = await this.getClassSummary(classId);
    if (!cls) return [];
    const roster = await this.listClassRosterMemberIds(classId);
    const staff = await this.listClassStaffUserIds(classId);
    return [...new Set([...roster, cls.ownerId, ...staff])];
  }
  async isClassMember(classId: string, userId: string): Promise<boolean> {
    const cls = await this.getClassSummary(classId);
    if (!cls) return false;
    if (cls.ownerId === userId) return true;
    const inRoster = await this.handle
      .selectFrom('cohort_members')
      .select('user_id as userId')
      .where('cohort_id', '=', cls.cohortId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    if (inRoster) return true;
    const classCtx = await this.handle
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', 45)
      .where('instance_id', '=', classId)
      .executeTakeFirst();
    if (!classCtx) return false;
    const assigned = await this.handle
      .selectFrom('role_assignments')
      .select('id')
      .where('context_id', '=', classCtx.id)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return Boolean(assigned);
  }
  async findClassConversation(classId: string, tx?: MessagingDb): Promise<ConversationRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_class')
      .where('item_type', '=', 'class')
      .where('item_id', '=', classId)
      .executeTakeFirst() as Promise<ConversationRow | undefined>;
  }
  async acquireClassConversationLock(tx: MessagingTx, classId: string): Promise<void> {
    const key = `messaging:core_class:${classId}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx);
  }
  async listClassConversationsForMember(userId: string): Promise<ConversationRow[]> {
    const relations = await this.listTreeClassesForUser(userId);
    if (!relations.length) return [];
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_class')
      .where('item_type', '=', 'class')
      .where('item_id', 'in', relations.map((r) => r.classId))
      .execute() as Promise<ConversationRow[]>;
  }
  async listClassRosterPage(classId: string, actorId: string, cursor: { displayName: string; username: string; userId: string } | null, limit: number): Promise<{
    userId: string; username: string; firstName: string; lastName: string; displayName: string; staff: boolean; enrolled: boolean;
  }[]> {
    const cursorCond = cursor
      ? sql`and ((case when btrim(u.first_name || ' ' || u.last_name) = '' then u.username else btrim(u.first_name || ' ' || u.last_name) end), u.username, u.id) > (${cursor.displayName}, ${cursor.username}, ${cursor.userId}::uuid)`
      : sql``;
    const executed = await sql<Record<string, unknown>>`
      with class_row as (
        select cohort_id, owner_id from classes where id = ${classId}
      ),
      class_ctx as (
        select id from "context" where context_level = 45 and instance_id = ${classId}
      ),
      member_flags as (
        select cm.user_id as user_id, false as staff, true as enrolled
        from cohort_members cm
        where cm.cohort_id = (select cohort_id from class_row)
        union all
        select ra.user_id as user_id, (r.archetype in ('manager', 'coursecreator', 'editingteacher', 'teacher')) as staff, false as enrolled
        from role_assignments ra
        join role r on r.id = ra.role_id
        where ra.context_id = (select id from class_ctx)
        union all
        select owner_id as user_id, true as staff, false as enrolled
        from class_row
      ),
      members as (
        select user_id, bool_or(staff) as staff, bool_or(enrolled) as enrolled from member_flags group by user_id
      )
      select u.id as user_id, u.username as username, u.first_name as first_name, u.last_name as last_name,
        (case when btrim(u.first_name || ' ' || u.last_name) = '' then u.username else btrim(u.first_name || ' ' || u.last_name) end) as display_name,
        m.staff as staff, m.enrolled as enrolled
      from members m
      join users u on u.id = m.user_id
      where u.deleted = false and u.suspended = false and u.is_guest = false
        and u.id <> ${actorId}
        and not exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${actorId} and b.blocked_user_id = u.id)
             or (b.user_id = u.id and b.blocked_user_id = ${actorId})
        )
        ${cursorCond}
      order by display_name asc, u.username asc, u.id asc
      limit ${limit}
    `.execute(this.handle);
    return executed.rows.map((raw) => ({
      userId: raw.user_id as string,
      username: raw.username as string,
      firstName: raw.first_name as string,
      lastName: raw.last_name as string,
      displayName: raw.display_name as string,
      staff: Boolean(raw.staff),
      enrolled: Boolean(raw.enrolled),
    }));
  }
  async findTeacherStudentSharedClassId(userA: string, userB: string): Promise<string | null> {
    const rows = await this.handle
      .selectFrom('context')
      .innerJoin('role_assignments', 'role_assignments.context_id', 'context.id')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('classes', 'classes.id', 'context.instance_id')
      .innerJoin('cohort_members', 'cohort_members.cohort_id', 'classes.cohort_id')
      .select('context.instance_id as classId')
      .where((eb) => eb.and([
        eb('context.context_level', '=', 45),
        eb('classes.status', '=', 'active'),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
        eb.or([
          eb.and([eb('role_assignments.user_id', '=', userA), eb('cohort_members.user_id', '=', userB)]),
          eb.and([eb('role_assignments.user_id', '=', userB), eb('cohort_members.user_id', '=', userA)]),
        ]),
      ]))
      .limit(1)
      .execute();
    return rows[0]?.classId ?? null;
  }


  async listTreeClassesForUser(userId: string): Promise<{ classId: string; name: string; isOwner: boolean; isClassStaff: boolean; isRosterMember: boolean }[]> {
    const owned = await this.handle
      .selectFrom('classes')
      .select(['id as classId', 'name'])
      .where('owner_id', '=', userId)
      .where('status', '=', 'active')
      .execute();
    const staffRows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .innerJoin('classes', 'classes.id', 'context.instance_id')
      .select(['context.instance_id as classId', 'classes.name as name'])
      .distinct()
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('context.context_level', '=', 45),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
        eb('classes.status', '=', 'active'),
      ]))
      .execute();
    const rosterRows = await this.handle
      .selectFrom('cohort_members')
      .innerJoin('classes', 'classes.cohort_id', 'cohort_members.cohort_id')
      .select(['classes.id as classId', 'classes.name as name'])
      .distinct()
      .where('cohort_members.user_id', '=', userId)
      .where('classes.status', '=', 'active')
      .execute();
    const byId = new Map<string, { classId: string; name: string; isOwner: boolean; isClassStaff: boolean; isRosterMember: boolean }>();
    const ensure = (classId: string | null, name: string) => {
      if (!classId) return undefined;
      let entry = byId.get(classId);
      if (!entry) {
        entry = { classId, name, isOwner: false, isClassStaff: false, isRosterMember: false };
        byId.set(classId, entry);
      }
      return entry;
    };
    for (const r of owned) { const e = ensure(r.classId, r.name); if (e) e.isOwner = true; }
    for (const r of staffRows) { const e = ensure(r.classId, r.name); if (e) e.isClassStaff = true; }
    for (const r of rosterRows) { const e = ensure(r.classId, r.name); if (e) e.isRosterMember = true; }
    return [...byId.values()];
  }

  async listCoursesByClassIds(classIds: string[]): Promise<{ courseId: string; fullName: string; classId: string }[]> {
    if (!classIds.length) return [];
    const rows = await this.handle
      .selectFrom('course')
      .select(['id as courseId', 'full_name as fullName', 'class_id as classId'])
      .where('class_id', 'in', classIds)
      .where('is_template', '=', false)
      .execute();
    return rows.filter((r): r is { courseId: string; fullName: string; classId: string } => r.classId !== null);
  }

  async listClassesOfCourses(courseIds: string[]): Promise<{ courseId: string; classId: string; className: string; classStatus: string }[]> {
    if (!courseIds.length) return [];
    const rows = await this.handle
      .selectFrom('course')
      .innerJoin('classes', 'classes.id', 'course.class_id')
      .select(['course.id as courseId', 'course.class_id as classId', 'classes.name as className', 'classes.status as classStatus'])
      .where('course.id', 'in', courseIds)
      .execute();
    return rows.filter((r): r is { courseId: string; classId: string; className: string; classStatus: string } => r.classId !== null);
  }

  async listCourseNames(courseIds: string[]): Promise<{ courseId: string; fullName: string }[]> {
    if (!courseIds.length) return [];
    return this.handle
      .selectFrom('course')
      .select(['id as courseId', 'full_name as fullName'])
      .where('id', 'in', courseIds)
      .execute();
  }

  async listTeachingCourseIds(userId: string, courseIds: string[]): Promise<string[]> {
    if (!courseIds.length) return [];
    const rows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .select('context.instance_id as courseId')
      .distinct()
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('context.context_level', '=', 50),
        eb('context.instance_id', 'in', courseIds),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
      ]))
      .execute();
    return rows.map((r) => r.courseId).filter((id): id is string => id !== null);
  }

  async listGroupNames(groupIds: string[]): Promise<{ groupId: string; name: string; courseId: string }[]> {
    if (!groupIds.length) return [];
    return this.handle
      .selectFrom('course_groups')
      .select(['id as groupId', 'name', 'course_id as courseId'])
      .where('id', 'in', groupIds)
      .where('name', '<>', 'Cả lớp')
      .execute();
  }

  async listCourseConversationsByCourseIds(courseIds: string[]): Promise<ConversationRow[]> {
    if (!courseIds.length) return [];
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_course')
      .where('item_type', '=', 'course')
      .where('item_id', 'in', courseIds)
      .execute() as Promise<ConversationRow[]>;
  }

  async listClassConversations(classIds: string[]): Promise<ConversationRow[]> {
    if (!classIds.length) return [];
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_class')
      .where('item_type', '=', 'class')
      .where('item_id', 'in', classIds)
      .execute() as Promise<ConversationRow[]>;
  }

  async listCourseAndClassConversations(): Promise<ConversationRow[]> {
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where((eb) => eb.or([
        eb.and([eb('component', '=', 'core_course'), eb('item_type', '=', 'course')]),
        eb.and([eb('component', '=', 'core_class'), eb('item_type', '=', 'class')]),
      ]))
      .execute() as Promise<ConversationRow[]>;
  }

  async listGroupConversationsByGroupIds(groupIds: string[]): Promise<ConversationRow[]> {
    if (!groupIds.length) return [];
    return this.handle
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_group')
      .where('item_type', '=', 'groups')
      .where('item_id', 'in', groupIds)
      .execute() as Promise<ConversationRow[]>;
  }


  async insertNotification(v: NewNotification, tx?: MessagingDb): Promise<NotificationRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('notifications')
      .values(notificationInsertValues(v))
      .returning(NOTIFICATION_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<NotificationRow>;
  }
  async countUnreadNotifications(userIdTo: string, tenantId?: string): Promise<number> {
    const row = await this.handle
      .selectFrom('notifications')
      .select(sql<number>`count(*)::int`.as('value'))
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('time_read', 'is', null),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .executeTakeFirst();
    return row?.value ?? 0;
  }
  async markNotificationRead(id: string, userIdTo: string, tenantId?: string): Promise<boolean> {
    const rows = await this.handle
      .updateTable('notifications')
      .set({ time_read: new Date() })
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('id', '=', id),
          eb('user_id_to', '=', userIdTo),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length > 0;
  }
  async markAllNotificationsRead(userIdTo: string, tenantId?: string): Promise<number> {
    const rows = await this.handle
      .updateTable('notifications')
      .set({ time_read: new Date() })
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('time_read', 'is', null),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length;
  }

  async listNotificationGroups(userIdTo: string, opts: {
    eventTypes?: string[];
    unreadOnly?: boolean;
    cursor?: { latestAt: Date; latestId: string };
    limit: number;
  }, tenantId?: string): Promise<NotificationGroupAggregateRow[]> {
    const where: RawBuilder<unknown>[] = [sql`user_id_to = ${userIdTo}`];
    if (tenantId !== undefined) where.push(sql`tenant_id = ${tenantId}`);
    if (opts.eventTypes && opts.eventTypes.length > 0) {
      where.push(sql`event_type in (${sql.join(opts.eventTypes.map((t) => sql`${t}`), sql`, `)})`);
    }
    const latestIdExpr = sql`(array_agg(id order by created_at desc, id desc))[1]`;
    const having: RawBuilder<unknown>[] = [];
    if (opts.unreadOnly) having.push(sql`count(*) filter (where time_read is null) > 0`);
    if (opts.cursor) {
      having.push(sql`(max(created_at), ${latestIdExpr}) < (${opts.cursor.latestAt}::timestamptz, ${opts.cursor.latestId}::uuid)`);
    }
    const query = sql<NotificationGroupAggregateRow>`
      select
        event_type as "eventType",
        component as "component",
        coalesce(nullif(context_url, ''), '') as "sourceKey",
        to_char((created_at at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') as "day",
        count(*)::int as "count",
        (count(*) filter (where time_read is null))::int as "unreadCount",
        max(created_at) as "latestAt",
        ${latestIdExpr}::text as "latestId"
      from notifications
      where ${sql.join(where, sql` and `)}
      group by event_type, component, coalesce(nullif(context_url, ''), ''), (created_at at time zone 'Asia/Ho_Chi_Minh')::date
      ${having.length > 0 ? sql`having ${sql.join(having, sql` and `)}` : sql``}
      order by max(created_at) desc, ${latestIdExpr} desc
      limit ${opts.limit}
    `;
    const res = await query.execute(this.handle);
    return res.rows;
  }

  async listNotificationsByIds(ids: string[], tenantId?: string): Promise<NotificationRow[]> {
    if (ids.length === 0) return [];
    return this.handle
      .selectFrom('notifications')
      .select(NOTIFICATION_COLUMNS)
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [eb('id', 'in', ids)];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .execute() as Promise<NotificationRow[]>;
  }

  async listNotificationItems(userIdTo: string, opts: NotificationItemsOptions, tenantId?: string): Promise<NotificationRow[]> {
    return this.handle
      .selectFrom('notifications')
      .select(NOTIFICATION_COLUMNS)
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [eb('user_id_to', '=', userIdTo)];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        if (opts.eventType) conds.push(eb('event_type', '=', opts.eventType));
        if (opts.eventTypes && opts.eventTypes.length > 0) conds.push(eb('event_type', 'in', opts.eventTypes));
        if (opts.source === null) {
          conds.push(sql<SqlBool>`coalesce(nullif(context_url, ''), '') = ''`);
        } else if (typeof opts.source === 'string') {
          conds.push(eb('context_url', '=', opts.source));
        }
        if (opts.day) {
          conds.push(sql<SqlBool>`to_char((created_at at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') = ${opts.day}`);
        }
        if (opts.unreadOnly) conds.push(eb('time_read', 'is', null));
        if (opts.cursor) {
          conds.push(sql<SqlBool>`(created_at, id) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id}::uuid)`);
        }
        return eb.and(conds);
      })
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit)
      .execute() as Promise<NotificationRow[]>;
  }

  async markNotificationGroupRead(userIdTo: string, key: { eventType: string; sourceKey: string; day: string }, tenantId?: string): Promise<number> {
    const rows = await this.handle
      .updateTable('notifications')
      .set({ time_read: new Date() })
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('event_type', '=', key.eventType),
          eb('time_read', 'is', null),
          sql<SqlBool>`coalesce(nullif(context_url, ''), '') = ${key.sourceKey}`,
          sql<SqlBool>`to_char((created_at at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') = ${key.day}`,
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length;
  }

  async deleteNotification(id: string, userIdTo: string, tenantId?: string): Promise<boolean> {
    const rows = await this.handle
      .deleteFrom('notifications')
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('id', '=', id),
          eb('user_id_to', '=', userIdTo),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length > 0;
  }

  async deleteReadNotifications(userIdTo: string, tenantId?: string): Promise<number> {
    const rows = await this.handle
      .deleteFrom('notifications')
      .where((eb) => {
        const conds: Expression<SqlBool>[] = [
          eb('user_id_to', '=', userIdTo),
          eb('time_read', 'is not', null),
        ];
        if (tenantId !== undefined) conds.push(eb('tenant_id', '=', tenantId));
        return eb.and(conds);
      })
      .returning('id')
      .execute();
    return rows.length;
  }

  async hasUnreadNotification(userIdTo: string, eventType: string, contextUrl: string): Promise<boolean> {
    const row = await this.handle
      .selectFrom('notifications')
      .select('id')
      .where('user_id_to', '=', userIdTo)
      .where('event_type', '=', eventType)
      .where('context_url', '=', contextUrl)
      .where('time_read', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async getGradeItemNotifyInfo(itemId: string): Promise<{ itemType: string; itemName: string; hidden: boolean; courseId: string } | undefined> {
    return this.handle
      .selectFrom('grade_items')
      .select(['item_type as itemType', 'item_name as itemName', 'hidden', 'course_id as courseId'])
      .where('id', '=', itemId)
      .executeTakeFirst();
  }

  async isGradeHiddenForUser(itemId: string, userId: string): Promise<boolean> {
    const row = await this.handle
      .selectFrom('grade_grades')
      .select('hidden')
      .where('item_id', '=', itemId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row?.hidden ?? false;
  }

  async getCourseFullName(courseId: string): Promise<string | undefined> {
    const row = await this.handle
      .selectFrom('course')
      .select('full_name as fullName')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.fullName;
  }


  async getAssignmentNotifyInfo(assignmentId: string): Promise<{
    name: string; courseId: string; courseVisible: boolean; cmVisible: boolean | null; cmDeletionInProgress: boolean | null;
  } | undefined> {
    return this.handle
      .selectFrom('assignments')
      .innerJoin('course', 'course.id', 'assignments.course')
      .leftJoin('course_modules', 'course_modules.id', 'assignments.cm_id')
      .select([
        'assignments.name as name',
        'assignments.course as courseId',
        'course.visible as courseVisible',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('assignments.id', '=', assignmentId)
      .executeTakeFirst();
  }

  async getPinNotifyInfo(pinId: string): Promise<{
    name: string; courseId: string; courseVisible: boolean; cmVisible: boolean | null; cmDeletionInProgress: boolean | null;
  } | undefined> {
    return this.handle
      .selectFrom('exam_pins')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .innerJoin('course', 'course.id', 'exam_pins.course_id')
      .leftJoin('course_modules', 'course_modules.id', 'exam_pins.cm_id')
      .select([
        sql<string>`coalesce(exam_pins.name, exam_versions.name)`.as('name'),
        'exam_pins.course_id as courseId',
        'course.visible as courseVisible',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('exam_pins.id', '=', pinId)
      .executeTakeFirst();
  }

  async countAssignmentSubmissionsAwaitingGrading(assignmentId: string): Promise<number> {
    const rows = await this.handle
      .selectFrom('assign_submissions')
      .leftJoin('assign_grades', (join) => join
        .onRef('assign_grades.assignment_id', '=', 'assign_submissions.assignment_id')
        .onRef('assign_grades.user_id', '=', 'assign_submissions.user_id')
        .onRef('assign_grades.attempt_number', '=', 'assign_submissions.attempt_number'))
      .select('assign_submissions.id as id')
      .where((eb) => eb.and([
        eb('assign_submissions.assignment_id', '=', assignmentId),
        eb('assign_submissions.status', '=', 'submitted'),
        eb.or([
          eb('assign_grades.id', 'is', null),
          eb('assign_grades.status', '<>', 'released'),
        ]),
      ]))
      .execute();
    return rows.length;
  }

  async countPinAttemptsNeedingGrading(pinId: string): Promise<number> {
    const rows = await this.handle
      .selectFrom('exam_attempts')
      .select('id')
      .where('pin_id', '=', pinId)
      .where('state', '=', 'needsgrading')
      .where('preview', '=', false)
      .execute();
    return rows.length;
  }

  async getUnreadNotification(userIdTo: string, eventType: string, contextUrl: string): Promise<NotificationRow | undefined> {
    return this.handle
      .selectFrom('notifications')
      .select(NOTIFICATION_COLUMNS)
      .where('user_id_to', '=', userIdTo)
      .where('event_type', '=', eventType)
      .where('context_url', '=', contextUrl)
      .where('time_read', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst() as Promise<NotificationRow | undefined>;
  }

  async updateNotificationContent(id: string, subject: string, fullMessage: string): Promise<void> {
    await this.handle
      .updateTable('notifications')
      .set({ subject, full_message: fullMessage, small_message: fullMessage.slice(0, 200) })
      .where('id', '=', id)
      .execute();
  }

  async getCourseTenantId(courseId: string): Promise<string | null> {
    const row = await this.handle
      .selectFrom('course')
      .select('tenant_id as tenantId')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.tenantId ?? null;
  }

  async getConversationTenantId(conversationId: string): Promise<string | null> {
    return this.store.getConversationTenantId(conversationId);
  }

  async getUserDefaultTenantId(userId: string): Promise<string | null> {
    const rows = await this.handle
      .selectFrom('tenant_memberships')
      .innerJoin('tenants', 'tenants.id', 'tenant_memberships.tenant_id')
      .select(['tenant_memberships.tenant_id as tenantId', 'tenants.kind as kind'])
      .where('tenant_memberships.user_id', '=', userId)
      .where('tenant_memberships.status', '=', 'active')
      .where('tenants.status', '=', 'active')
      .execute();
    const distinct = [...new Map(rows.map((r) => [r.tenantId, r])).values()];
    if (distinct.length === 1) return distinct[0]!.tenantId;
    if (distinct.length > 1) {
      const nonPlatform = distinct.find((r) => r.kind !== 'platform');
      if (nonPlatform) return nonPlatform.tenantId;
    }
    const zero = await this.handle
      .selectFrom('tenants')
      .select('id')
      .where('kind', '=', 'platform')
      .executeTakeFirst();
    return zero?.id ?? null;
  }

  async insertDispatchLog(v: NewDispatchLog, tx?: MessagingDb): Promise<DispatchLogRow> {
    const db = tx ?? this.handle;
    const row = await db
      .insertInto('notification_dispatch_log')
      .values(dispatchLogInsertValues(v))
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning(DISPATCH_LOG_COLUMNS)
      .executeTakeFirst();
    if (row) return row as DispatchLogRow;
    const existing = await this.handle
      .selectFrom('notification_dispatch_log')
      .select(DISPATCH_LOG_COLUMNS)
      .where('dedupe_key', '=', v.dedupeKey!)
      .executeTakeFirstOrThrow();
    return existing as DispatchLogRow;
  }
  async listDispatchLog(userId: string): Promise<DispatchLogRow[]> {
    return this.handle
      .selectFrom('notification_dispatch_log')
      .select(DISPATCH_LOG_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute() as Promise<DispatchLogRow[]>;
  }
}
