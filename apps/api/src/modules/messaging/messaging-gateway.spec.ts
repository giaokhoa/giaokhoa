import { describe, expect, it, vi } from 'vitest';
import { MessagingGateway } from './messaging.gateway';
import { tenantAls } from '../tenants/tenant-als';

describe('MessagingGateway.handleConnection — danh sách chặn tải một lần cho cả lần nối', () => {
  const USER_ID = 'user-1';
  const TENANT_ID = 'tenant-1';
  const BLOCKED_PEER = 'user-blocked';

  function build(opts: { spaceSlug?: string | null } = {}) {
    const conversations = [
      { id: 'conv-blocked', tenantId: TENANT_ID },
      { id: 'conv-open-a', tenantId: TENANT_ID },
      { id: 'conv-open-b', tenantId: TENANT_ID },
      { id: 'conv-group', tenantId: TENANT_ID },
    ];
    const peers: Record<string, string> = {
      'conv-blocked': BLOCKED_PEER,
      'conv-open-a': 'user-a',
      'conv-open-b': 'user-b',
    };
    const spaceProbe = { insideSpace: false, currentSpaceId: 'space-a', slugs: [] as string[], listInsideSpace: [] as boolean[] };
    const repo = {
      listConversationsForUser: vi.fn(async () => {
        spaceProbe.listInsideSpace.push(spaceProbe.insideSpace);
        return conversations;
      }),
      getConversation: vi.fn(async (id: string) => ({
        id,
        type: id === 'conv-group' ? 2 : 1,
        tenantId: TENANT_ID,
      })),
      listMembers: vi.fn(async (id: string) => [USER_ID, peers[id]!]),
      listBlockedCounterpartIds: vi.fn(async () => [BLOCKED_PEER]),
      isMember: vi.fn(async () => true),
      listMessages: vi.fn(async () => [{ id: 'msg-from-current-store', seq: 1 }]),
      attachQuotes: vi.fn(async (messages: unknown[]) => messages),
    };
    const auth = {
      authenticateHandshake: vi.fn(async () => ({
        userId: USER_ID, username: 'user1', tenantId: TENANT_ID, spaceSlug: opts.spaceSlug ?? null,
        spaceId: opts.spaceSlug ? 'space-a' : null,
      })),
    };
    const realtime = {
      markConnected: vi.fn(async () => {}),
      markDisconnected: vi.fn(async () => {}),
      noteTyping: vi.fn(async () => {}),
      listOnlineCoMemberIds: vi.fn(async () => ['user-a']),
    };
    const spaceDb = {
      resolveTarget: vi.fn(async (slug: string) => ({ slug, mode: 'dedicated', status: 'active', spaceId: spaceProbe.currentSpaceId })),
      withSpaceKysely: vi.fn(async (slug: string, fn: () => Promise<unknown>) => {
        spaceProbe.slugs.push(slug);
        spaceProbe.insideSpace = true;
        try {
          return await tenantAls.run({ platform: true, spaceSlug: slug, spaceId: spaceProbe.currentSpaceId }, fn);
        } finally {
          spaceProbe.insideSpace = false;
        }
      }),
    };
    const gateway = new MessagingGateway(auth as never, repo as never, realtime as never, spaceDb as never);
    const joinedRooms: string[] = [];
    const client = {
      id: 'socket-1',
      data: {} as Record<string, unknown>,
      handshake: {},
      join: vi.fn(async (room: string) => {
        joinedRooms.push(room);
      }),
      leave: vi.fn(async () => {}),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    return { gateway, repo, client, realtime, joinedRooms, spaceDb, spaceProbe };
  }

  it('nhiều hội thoại 1–1 trong một lần nối: danh sách chặn chỉ tải đúng một lần, room bị chặn không được vào', async () => {
    const { gateway, repo, client, joinedRooms } = build();

    await gateway.handleConnection(client as never);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(repo.listBlockedCounterpartIds).toHaveBeenCalledTimes(1);
    expect(repo.listBlockedCounterpartIds).toHaveBeenCalledWith(USER_ID);
    expect(joinedRooms).toHaveLength(4);
    expect(joinedRooms.some((room) => room.includes('conv-blocked'))).toBe(false);
    expect(joinedRooms.some((room) => room.includes('conv-open-a'))).toBe(true);
    expect(joinedRooms.some((room) => room.includes('conv-open-b'))).toBe(true);
    expect(joinedRooms.some((room) => room.includes('conv-group'))).toBe(true);
    expect(joinedRooms.some((room) => room.includes(`user:${USER_ID}`))).toBe(true);
  });

  it('phát ảnh chụp presence cho chính socket vừa nối, sau khi đã ghi presence của người nối', async () => {
    const { gateway, client, realtime } = build();

    await gateway.handleConnection(client as never);

    expect(realtime.listOnlineCoMemberIds).toHaveBeenCalledTimes(1);
    expect(realtime.listOnlineCoMemberIds).toHaveBeenCalledWith(USER_ID);
    expect(client.emit).toHaveBeenCalledTimes(1);
    expect(client.emit).toHaveBeenCalledWith('presence.snapshot', { onlineUserIds: ['user-a'] });
    expect(realtime.markConnected.mock.invocationCallOrder[0]!)
      .toBeLessThan(realtime.listOnlineCoMemberIds.mock.invocationCallOrder[0]!);
  });

  it('kết nối mang slug của trung tâm kho riêng: lượt đọc lúc nối chạy trong kho của trung tâm, room vào như cũ', async () => {
    const { gateway, client, joinedRooms, spaceDb, spaceProbe } = build({ spaceSlug: 'trung-tam-a' });

    await gateway.handleConnection(client as never);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(spaceDb.withSpaceKysely).toHaveBeenCalled();
    expect(spaceProbe.slugs.every((slug) => slug === 'trung-tam-a')).toBe(true);
    expect(spaceProbe.listInsideSpace).toEqual([true]);
    expect(joinedRooms).toHaveLength(4);
    expect(joinedRooms.some((room) => room.includes('conv-blocked'))).toBe(false);
  });

  it('socket A vẫn còn nối nhưng slug bị tái gán sang B: chặn join/sync/typing trước khi đọc kho B', async () => {
    const { gateway, client, repo, spaceDb, spaceProbe, realtime, joinedRooms } = build({ spaceSlug: 'trung-tam-a' });
    await gateway.handleConnection(client as never);
    const before = joinedRooms.length;
    const beforeReads = repo.isMember.mock.calls.length;
    spaceProbe.currentSpaceId = 'space-b';
    await expect(gateway.joinConversation(client as never, { conversationId: 'conv-open-a' }))
      .rejects.toMatchObject({ code: 'space_routing.socket_identity_mismatch' });
    await expect(gateway.sync(client as never, { 'conv-open-a': 0 }))
      .rejects.toMatchObject({ code: 'space_routing.socket_identity_mismatch' });
    await expect(gateway.typing(client as never, { conversationId: 'conv-open-a' }))
      .rejects.toMatchObject({ code: 'space_routing.socket_identity_mismatch' });
    expect(repo.isMember).toHaveBeenCalledTimes(beforeReads);
    expect(realtime.noteTyping).not.toHaveBeenCalled();
    expect(joinedRooms).toHaveLength(before);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(spaceDb.withSpaceKysely).toHaveBeenCalledTimes(1);
  });

  it('registry trả A nhưng chuẩn bị pool đã sang B: từ chối ngay trong phiên, không chạy callback', async () => {
    const { gateway, client, repo, spaceDb, spaceProbe } = build({ spaceSlug: 'trung-tam-a' });
    await gateway.handleConnection(client as never);
    spaceDb.resolveTarget.mockResolvedValue({ slug: 'trung-tam-a', mode: 'dedicated', status: 'active', spaceId: 'space-a' });
    spaceProbe.currentSpaceId = 'space-b';
    await expect(gateway.joinConversation(client as never, { conversationId: 'conv-open-a' }))
      .rejects.toMatchObject({ code: 'space_routing.socket_identity_mismatch' });
    expect(repo.isMember).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('socket đã xác thực nhưng registry đóng không gian: từ chối sự kiện và ngắt kết nối', async () => {
    const { gateway, client, repo, spaceDb } = build({ spaceSlug: 'trung-tam-a' });
    await gateway.handleConnection(client as never);
    spaceDb.resolveTarget.mockResolvedValue({ slug: 'trung-tam-a', mode: 'dedicated', status: 'closed', spaceId: 'space-a' });
    await expect(gateway.joinConversation(client as never, { conversationId: 'conv-open-a' }))
      .rejects.toMatchObject({ code: 'space_routing.socket_identity_mismatch' });
    expect(repo.isMember).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it.each(['join', 'sync', 'typing'] as const)(
    'socket đang xử lý %s: đổi registry giữa await membership và lúc trả ACK thì ngắt, không ACK sang B',
    async (event) => {
      const { gateway, client, repo, realtime, spaceProbe, joinedRooms } = build({ spaceSlug: 'trung-tam-a' });
      await gateway.handleConnection(client as never);
      const roomsBefore = joinedRooms.length;
      const scopesAfterSwitch: Array<string | undefined> = [];
      repo.isMember.mockImplementation(async () => {
        expect(tenantAls.getStore()?.spaceId).toBe('space-a');
        spaceProbe.currentSpaceId = 'space-b';
        return true;
      });
      repo.getConversation.mockImplementation(async (id: string) => {
        scopesAfterSwitch.push(tenantAls.getStore()?.spaceId);
        return { id, type: 1, tenantId: TENANT_ID };
      });
      repo.listMessages.mockResolvedValue([]);
      const call = event === 'join'
        ? gateway.joinConversation(client as never, { conversationId: 'conv-open-a' })
        : event === 'sync'
          ? gateway.sync(client as never, { 'conv-open-a': 0 })
          : gateway.typing(client as never, { conversationId: 'conv-open-a' });
      await expect(call).rejects.toMatchObject({ code: 'space_routing.socket_identity_mismatch' });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(joinedRooms.slice(roomsBefore).every((room) => !room.includes('space-b'))).toBe(true);
      expect(scopesAfterSwitch.every((scope) => scope === 'space-a')).toBe(true);
      expect(realtime.noteTyping).toHaveBeenCalledTimes(event === 'typing' ? 1 : 0);
    },
  );

  it('kết nối thuộc đường kho chung (không slug): không qua lớp bọc kho nào', async () => {
    const { gateway, client, spaceDb, spaceProbe } = build();

    await gateway.handleConnection(client as never);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(spaceDb.withSpaceKysely).not.toHaveBeenCalled();
    expect(spaceProbe.listInsideSpace).toEqual([false]);
  });
});
