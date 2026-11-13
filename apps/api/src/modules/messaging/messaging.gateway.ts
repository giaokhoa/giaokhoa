import { Logger } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
  SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import {
  MESSAGING_SOCKET_EVENTS,
  type MessagingSyncRequest, type MessagingSyncResult,
} from '@giaokhoa/contracts';
import type { Namespace, Socket } from 'socket.io';
import { Public } from '../../common/public.decorator';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingError } from '../../db/routing/space-connection-resolver';
import { tenantAls } from '../tenants/tenant-als';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';
import { blankRecalledContent } from '@giaokhoa/messaging';
import { MessagingSocketAuth, type MessagingSocketIdentity } from './messaging-socket-auth';
import { conversationRoom, toWireMessage, userRoom } from '@giaokhoa/messaging';
import { MessagingRealtimeService } from './messaging-realtime.service';

const SYNC_LIMIT_PER_CONVERSATION = 100;
const SYNC_MAX_CONVERSATIONS = 50;






































@Public()
@WebSocketGateway({ namespace: '/messaging' })
export class MessagingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    private readonly auth: MessagingSocketAuth,
    private readonly repo: MessagingRepository,
    private readonly realtime: MessagingRealtimeService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}

  private async withConnectionSpace<T>(client: Socket, fn: () => Promise<T>): Promise<T> {
    const slug = client.data.spaceSlug as string | null | undefined;
    const pinnedSpaceId = client.data.spaceId as string | null | undefined;
    if (!slug) {
      if (pinnedSpaceId) {
        client.disconnect(true);
        throw new SpaceRoutingError('space_routing.socket_identity_mismatch', 'Socket has an identity without a space slug');
      }
      return fn();
    }
    try {
      const target = await this.spaceDb.resolveTarget(slug);
      if (!pinnedSpaceId || target.mode !== 'dedicated' || target.status !== 'active' || target.spaceId !== pinnedSpaceId) {
        throw new SpaceRoutingError('space_routing.socket_identity_mismatch', `Space identity changed for socket ${slug}`);
      }
      return await this.spaceDb.withSpaceKysely(slug, async () => {
        const prepared = await this.spaceDb.resolveTarget(slug);
        if (tenantAls.getStore()?.spaceId !== pinnedSpaceId || prepared.spaceId !== pinnedSpaceId
          || prepared.mode !== 'dedicated' || prepared.status !== 'active') {
          throw new SpaceRoutingError('space_routing.socket_identity_mismatch', `Space preparation changed for socket ${slug}`);
        }
        const result = await fn();
        const after = await this.spaceDb.resolveTarget(slug);
        if (after.spaceId !== pinnedSpaceId || after.mode !== 'dedicated' || after.status !== 'active') {
          throw new SpaceRoutingError('space_routing.socket_identity_mismatch', `Space changed during socket handler ${slug}`);
        }
        return result;
      });
    } catch (error) {
      client.disconnect(true);
      throw error;
    }
  }

  /**
   * Socket.IO chờ callback của namespace middleware trước khi công nhận
   * kết nối. Không xác thực trong onConnect bất đồng bộ vì Socket.IO không
   * chờ hook đó, client chưa được kiểm tra đã có thể emit sự kiện.
   */
  afterInit(server: Namespace): void {
    this.realtime.attachServer(server);
    server.use((client, next) => {
      void this.auth.authenticateHandshake(client.handshake).then(
        (identity) => {
          if (!identity) return next(new Error('Unauthorized'));
          client.data.authIdentity = identity;
          next();
        },
        (error: unknown) => {
          this.logger.warn(`Handshake realtime thất bại: ${error instanceof Error ? error.message : 'unknown'}`);
          next(new Error('Unauthorized'));
        },
      );
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    let resolveAuth!: () => void;
    client.data.authSettled = new Promise<void>((resolve) => {
      resolveAuth = resolve;
    });
    try {
      // Handshake production đã được kiểm chứng trước ACK ở server.use.
      // Fallback chỉ dành cho test gọi trực tiếp hook; không tái kiểm
      // tra phiên trong cửa sổ chuyển từ middleware sang handleConnection.
      const preAuthenticated = client.data.authIdentity as MessagingSocketIdentity | undefined;
      delete client.data.authIdentity;
      const identity = preAuthenticated ?? await this.auth.authenticateHandshake(client.handshake);
      if (!identity) {
        client.disconnect(true);
        return;
      }
      client.data.userId = identity.userId;
      client.data.username = identity.username;
      client.data.tenantId = identity.tenantId;
      client.data.spaceSlug = identity.spaceSlug;
      client.data.spaceId = identity.spaceId ?? null;
      await this.withConnectionSpace(client, async () => {
        await client.join(userRoom(identity.tenantId, identity.userId, identity.spaceId));
        const conversations = await this.repo.listConversationsForUser(identity.userId);
        let blockedIds: string[] | undefined;
        const blockedIdsOnce = async (): Promise<string[]> => {
          blockedIds ??= await this.repo.listBlockedCounterpartIds(identity.userId);
          return blockedIds;
        };
        for (const conversation of conversations) {
          if (await this.isBlockedDirectConversation(conversation.id, identity.userId, blockedIdsOnce)) continue;
          await client.join(conversationRoom(conversation.tenantId, conversation.id, identity.spaceId));
        }
        await this.realtime.markConnected(identity.tenantId, identity.userId, client.id);
        const onlineCoMemberIds = await this.realtime.listOnlineCoMemberIds(identity.userId);
        client.emit(MESSAGING_SOCKET_EVENTS.presenceSnapshot, { onlineUserIds: onlineCoMemberIds });
      });
    } catch (error) {
      this.logger.warn(`Kết nối realtime của messaging bị ngắt do lỗi: ${(error as Error).message}`);
      client.disconnect(true);
    } finally {
      resolveAuth();
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    const tenantId = (client.data.tenantId as string | null | undefined) ?? null;
    if (userId) {
      try {
        await this.withConnectionSpace(client, () => this.realtime.markDisconnected(tenantId, userId, client.id));
      } catch (error) {
        this.logger.warn(`Dọn presence kho cũ của socket ${client.id}: ${(error as Error).message}`);
        await tenantAls.run({ platform: true, spaceId: (client.data.spaceId as string | null) ?? undefined }, () =>
          this.realtime.markDisconnected(tenantId, userId, client.id, false));
      }
    }
  }

  private async isBlockedDirectConversation(
    conversationId: string,
    userId: string,
    blockedIdsSource?: () => Promise<string[]>,
  ): Promise<boolean> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation || conversation.type !== 1) return false;
    const members = await this.repo.listMembers(conversationId);
    const other = members.find((id) => id !== userId);
    if (!other) return false;
    const blockedIds = blockedIdsSource
      ? await blockedIdsSource()
      : await this.repo.listBlockedCounterpartIds(userId);
    return blockedIds.includes(other);
  }

  @SubscribeMessage(MESSAGING_SOCKET_EVENTS.joinConversation)
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ joined: boolean }> {
    const userId = await awaitConnectionUser(client);
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!userId || !conversationId) return { joined: false };
    return this.withConnectionSpace(client, async () => {
      if (!(await this.repo.isMember(conversationId, userId))) return { joined: false };
      if (await this.isBlockedDirectConversation(conversationId, userId)) return { joined: false };
      const conversation = await this.repo.getConversation(conversationId);
      await client.join(conversationRoom(conversation?.tenantId ?? null, conversationId, tenantAls.getStore()?.spaceId));
      return { joined: true };
    });
  }

  @SubscribeMessage(MESSAGING_SOCKET_EVENTS.leaveConversation)
  async leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ left: boolean }> {
    await awaitConnectionUser(client);
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId) return { left: false };
    return this.withConnectionSpace(client, async () => {
      const conversation = await this.repo.getConversation(conversationId);
      await client.leave(conversationRoom(conversation?.tenantId ?? null, conversationId, tenantAls.getStore()?.spaceId));
      return { left: true };
    });
  }

  @SubscribeMessage(MESSAGING_SOCKET_EVENTS.sync)
  async sync(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: MessagingSyncRequest,
  ): Promise<MessagingSyncResult> {
    const userId = await awaitConnectionUser(client);
    const result: MessagingSyncResult = {};
    if (!userId || !body || typeof body !== 'object') return result;
    return this.withConnectionSpace(client, async () => {
      const entries = Object.entries(body).slice(0, SYNC_MAX_CONVERSATIONS);
      for (const [conversationId, lastSeq] of entries) {
        if (typeof lastSeq !== 'number' || !Number.isFinite(lastSeq) || lastSeq < 0) continue;
        if (!(await this.repo.isMember(conversationId, userId))) continue;
        if (await this.isBlockedDirectConversation(conversationId, userId)) continue;
        const conversation = await this.repo.getConversation(conversationId);
        await client.join(conversationRoom(conversation?.tenantId ?? null, conversationId, tenantAls.getStore()?.spaceId));
        const missing = await this.repo.listMessages(conversationId, {
          afterSeq: Math.floor(lastSeq),
          limit: SYNC_LIMIT_PER_CONVERSATION,
          viewerId: userId,
        });
        if (missing.length) {
          const withQuotes = await this.repo.attachQuotes(missing, { privileged: false, viewerId: userId });
          result[conversationId] = withQuotes.map((row) => toWireMessage(blankRecalledContent(row), row.replyTo));
        }
      }
      return result;
    });
  }

  @SubscribeMessage(MESSAGING_SOCKET_EVENTS.typing)
  async typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ ok: boolean }> {
    const userId = await awaitConnectionUser(client);
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!userId || !conversationId) return { ok: false };
    return this.withConnectionSpace(client, async () => {
      if (!(await this.repo.isMember(conversationId, userId))) return { ok: false };
      if (await this.isBlockedDirectConversation(conversationId, userId)) return { ok: false };
      await this.realtime.noteTyping(conversationId, userId);
      return { ok: true };
    });
  }
}

async function awaitConnectionUser(client: Socket): Promise<string | undefined> {
  const settled = client.data.authSettled as Promise<void> | undefined;
  if (settled) await settled;
  return client.data.userId as string | undefined;
}
