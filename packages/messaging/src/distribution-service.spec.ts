import { describe, expect, it, vi } from 'vitest';
import { MESSAGING_SOCKET_EVENTS } from '@giaokhoa/contracts';
import { createMessagingDistributionService } from './distribution-service.js';
import type { MessagingDistributionStore } from './distribution-store.js';
import type { RealtimeEmitter } from './distribution-service.js';
import type { MessageRow } from './message-wire.js';
import { conversationRoom, userRoom } from './realtime-rooms.js';

describe('Tầng phân phối realtime — cổng chặn 1–1 fail-closed khi phân phối tin mới', () => {
  const CONVERSATION_ID = 'conv-1';
  const TENANT_ID = 'tenant-1';
  const USER_A = 'user-a';
  const USER_B = 'user-b';

  const messageRow = {
    id: 'msg-1',
    conversationId: CONVERSATION_ID,
    userIdFrom: USER_A,
    subject: '',
    fullMessage: 'xin chào',
    smallMessage: 'xin chào',
    createdAt: new Date('2026-10-28T00:00:00.000Z'),
    seq: 1,
    clientMessageId: 'client-1',
    deletedAt: null,
    deletedBy: null,
    recalledAt: null,
    recalledBy: null,
    replyToMessageId: null,
  } as unknown as MessageRow;

  function build(opts: { blockedLookup: () => Promise<string[]> }) {
    const emits: { room: string; event: string; payload: unknown }[] = [];
    const emitter: RealtimeEmitter = {
      emitToRoom: (room, event, payload) => {
        emits.push({ room, event, payload });
      },
      fetchSocketsInRoom: async () => [],
    };
    const store = {
      getMessage: vi.fn(async () => messageRow),
      listMembers: vi.fn(async () => [USER_A, USER_B]),
      getConversation: vi.fn(async () => ({ id: CONVERSATION_ID, type: 1, tenantId: TENANT_ID })),
      getConversationTenantId: vi.fn(async () => TENANT_ID),
      listBlockedCounterpartIds: vi.fn(opts.blockedLookup),
      attachQuotes: vi.fn(async (rows: MessageRow[]) => rows.map((r) => ({ ...r, replyTo: null }))),
      countUnreadForConversation: vi.fn(async () => 0),
      listMessages: vi.fn(async () => [] as MessageRow[]),
    } as unknown as MessagingDistributionStore;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const service = createMessagingDistributionService({ store, emitter, logger });
    return { service, store, emits };
  }

  it('tra danh sách chặn lỗi thì nén toàn bộ lượt phân phối, không phát sự kiện nào', async () => {
    const { service, emits } = build({
      blockedLookup: async () => {
        throw new Error('database connection lost');
      },
    });

    await service.distributeNewMessage(messageRow, [USER_A, USER_B]);

    expect(emits).toEqual([]);
  });

  it('cặp đang chặn (tra cứu thành công) thì không phát sự kiện nào', async () => {
    const { service, emits } = build({ blockedLookup: async () => [USER_B] });

    await service.distributeNewMessage(messageRow, [USER_A, USER_B]);

    expect(emits).toEqual([]);
  });

  it('cặp không chặn (tra cứu thành công) thì phát message.new vào room hội thoại và conversation.updated cho từng thành viên', async () => {
    const { service, emits } = build({ blockedLookup: async () => [] });

    await service.distributeNewMessage(messageRow, [USER_A, USER_B]);

    const events = emits.map((e) => e.event);
    expect(events).toContain(MESSAGING_SOCKET_EVENTS.newMessage);
    expect(events.filter((e) => e === MESSAGING_SOCKET_EVENTS.conversationUpdated)).toHaveLength(2);
    expect(emits.find((e) => e.event === MESSAGING_SOCKET_EVENTS.newMessage)?.room)
      .toBe(conversationRoom(TENANT_ID, CONVERSATION_ID));
  });

  it('sự kiện message_sent thiếu messageId trong payload thì bị bỏ qua, không đọc dữ kiện và không phát gì', async () => {
    const { service, store, emits } = build({ blockedLookup: async () => [] });

    await service.distributeEvent('message_sent', { conversationId: CONVERSATION_ID });

    expect(store.getMessage).not.toHaveBeenCalled();
    expect(emits).toEqual([]);
  });

  it('sự kiện message_sent mà tin đã bị thu hồi trước lúc phân phối thì phát như một lần thu hồi, không lộ nội dung qua message.new', async () => {
    const { service, store, emits } = build({ blockedLookup: async () => [] });
    const recalledRow = { ...messageRow, recalledAt: new Date('2026-10-28T00:01:00.000Z'), recalledBy: USER_A } as unknown as MessageRow;
    (store.getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(recalledRow);

    await service.distributeEvent('message_sent', { messageId: recalledRow.id, conversationId: CONVERSATION_ID });

    const events = emits.map((e) => e.event);
    expect(events).not.toContain(MESSAGING_SOCKET_EVENTS.newMessage);
    expect(events).toContain(MESSAGING_SOCKET_EVENTS.messageDeleted);
    expect(events).toContain(MESSAGING_SOCKET_EVENTS.conversationInvalidate);
  });

  it('sự kiện message_deleted_for_me chỉ phát vào room riêng của chính người xoá, không phát vào room hội thoại và không phát cho phía kia', async () => {
    const { service, emits } = build({ blockedLookup: async () => [] });

    await service.distributeEvent('message_deleted_for_me', {
      conversationId: CONVERSATION_ID, messageId: 'msg-1', seq: 1, actorId: USER_A,
    });

    expect(emits.length).toBeGreaterThan(0);
    expect(emits.every((e) => e.room === userRoom(TENANT_ID, USER_A))).toBe(true);
    expect(emits.some((e) => e.room === conversationRoom(TENANT_ID, CONVERSATION_ID))).toBe(false);
    expect(emits.some((e) => e.room === userRoom(TENANT_ID, USER_B))).toBe(false);
  });

  it('khi xoá tin thì vẫn cập nhật tin cuối và số chưa đọc cho từng thành viên', async () => {
    const { service, store, emits } = build({ blockedLookup: async () => [] });
    (store.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([messageRow]);
    (store.countUnreadForConversation as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conversationId: string, memberId: string) => memberId === USER_A ? 2 : 5,
    );

    await service.distributeMessageDeleted({ ...messageRow, deletedAt: new Date('2026-10-28T00:01:00.000Z'), deletedBy: USER_A }, [USER_A, USER_B]);

    const updates = emits.filter((e) => e.event === MESSAGING_SOCKET_EVENTS.conversationUpdated);
    expect(updates.map((e) => [e.room, e.payload])).toEqual([
      [userRoom(TENANT_ID, USER_A), expect.objectContaining({ unreadCount: 2, message: expect.objectContaining({ id: messageRow.id }) })],
      [userRoom(TENANT_ID, USER_B), expect.objectContaining({ unreadCount: 5, message: expect.objectContaining({ id: messageRow.id }) })],
    ]);
  });

  it('khi thu hồi tin thì cập nhật nội dung rỗng và vô hiệu hội thoại cho từng thành viên', async () => {
    const { service, store, emits } = build({ blockedLookup: async () => [] });
    const recalled = { ...messageRow, recalledAt: new Date('2026-10-28T00:01:00.000Z'), recalledBy: USER_A } as MessageRow;
    (store.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([recalled]);

    await service.distributeMessageRecalled(recalled, [USER_A, USER_B]);

    const updates = emits.filter((e) => e.event === MESSAGING_SOCKET_EVENTS.conversationUpdated);
    expect(updates).toHaveLength(2);
    expect(updates.map((e) => e.payload)).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ fullMessage: '' }) }),
      expect.objectContaining({ message: expect.objectContaining({ fullMessage: '' }) }),
    ]);
    expect(emits.filter((e) => e.event === MESSAGING_SOCKET_EVENTS.conversationInvalidate)).toHaveLength(2);
  });

  it('khi xoá cứng tin thì vẫn gửi cập nhật hội thoại và vô hiệu hội thoại', async () => {
    const { service, store, emits } = build({ blockedLookup: async () => [] });
    (store.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([messageRow]);

    await service.distributeMessageRemoved({ conversationId: CONVERSATION_ID, messageId: messageRow.id, seq: 1, removedBy: USER_A }, [USER_A, USER_B]);

    expect(emits.filter((e) => e.event === MESSAGING_SOCKET_EVENTS.conversationUpdated)).toHaveLength(2);
    expect(emits.filter((e) => e.event === MESSAGING_SOCKET_EVENTS.conversationInvalidate)).toHaveLength(2);
  });

  it('khi xoá tin mà tra danh sách chặn bị lỗi thì không phát bất kỳ sự kiện nào', async () => {
    const { service, emits } = build({ blockedLookup: async () => { throw new Error('database connection lost'); } });

    await service.distributeMessageDeleted({ ...messageRow, deletedAt: new Date('2026-10-28T00:01:00.000Z') }, [USER_A, USER_B]);

    expect(emits).toEqual([]);
  });
});
