import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MESSAGING_SOCKET_EVENTS } from '@giaokhoa/contracts';
import { conversationRoom, tenantRealtimeSegment, userRoom } from '@giaokhoa/messaging';
import { tenantAls } from '../tenants/tenant-als';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { redisTlsFromUrl } from '../../config/env';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';

const PRESENCE_KEY_PREFIX = 'giaokhoa:messaging:presence:';
const TYPING_KEY_PREFIX = 'giaokhoa:messaging:typing:';
const PRESENCE_TTL_SECONDS_DEFAULT = 600;
const PRESENCE_REFRESH_MS_DEFAULT = 120_000;
const TYPING_TTL_SECONDS = 4;

@Injectable()
export class MessagingRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagingRealtimeService.name);
  private readonly redisUrl: string;
  private readonly redisOptions: Record<string, unknown>;
  private server: Server | null = null;
  private adapterClients: Redis[] = [];
  private stateClient: Redis | null = null;
  private readonly presenceTtlSeconds: number;
  private readonly presenceRefreshMs: number;
  private readonly localPresence = new Map<string, Set<string>>();
  private presenceTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly repo: MessagingRepository,
  ) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.redisOptions = { maxRetriesPerRequest: null, ...redisTlsFromUrl(this.redisUrl) };
    this.presenceTtlSeconds = config.get<number>('MESSAGING_PRESENCE_TTL_SECONDS') ?? PRESENCE_TTL_SECONDS_DEFAULT;
    this.presenceRefreshMs = config.get<number>('MESSAGING_PRESENCE_REFRESH_MS') ?? PRESENCE_REFRESH_MS_DEFAULT;
  }

  attachServer(server: Server): void {
    this.server = server;
    try {
      const pub = new Redis(this.redisUrl, this.redisOptions);
      const sub = pub.duplicate();
      pub.on('error', (error: Error) => this.logger.warn(`Redis adapter (pub) của messaging lỗi: ${error.message}`));
      sub.on('error', (error: Error) => this.logger.warn(`Redis adapter (sub) của messaging lỗi: ${error.message}`));
      this.adapterClients = [pub, sub];
      server.adapter(createAdapter(pub, sub) as never);
    } catch (error) {
      this.logger.warn(`Không gắn được Redis adapter cho messaging, dùng adapter in-memory: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.localPresence.clear();
    await Promise.allSettled([
      ...this.adapterClients.map((c) => c.quit()),
      ...(this.stateClient ? [this.stateClient.quit()] : []),
    ]);
    this.adapterClients = [];
    this.stateClient = null;
    this.server = null;
  }

  private state(): Redis {
    if (!this.stateClient) {
      this.stateClient = new Redis(this.redisUrl, this.redisOptions);
      this.stateClient.on('error', (error: Error) => {
        this.logger.warn(`Redis trạng thái (presence/typing) của messaging lỗi: ${error.message}`);
      });
    }
    return this.stateClient;
  }

  private async tenantIdOfConversation(conversationId: string): Promise<string | null> {
    return this.repo.getConversationTenantId(conversationId).catch(() => null);
  }

  async rejoinDirectConversationAfterUnblock(userId: string, otherUserId: string): Promise<void> {
    if (!this.server) return;
    try {
      const conversations = await this.repo.listConversationsForUser(userId);
      for (const c of conversations) {
        if (c.type !== 1) continue;
        const members = await this.repo.listMembers(c.id);
        if (members.length === 2 && members.includes(userId) && members.includes(otherUserId)) {
          const room = conversationRoom(c.tenantId, c.id, tenantAls.getStore()?.spaceId);
          await this.server.in(userRoom(c.tenantId, userId, tenantAls.getStore()?.spaceId)).socketsJoin(room);
          await this.server.in(userRoom(c.tenantId, otherUserId, tenantAls.getStore()?.spaceId)).socketsJoin(room);
        }
      }
    } catch (error) {
      this.logger.warn(`Không nối lại được room sau bỏ chặn cho ${userId}: ${(error as Error).message}`);
    }
  }

  async evictUserFromConversation(userId: string, conversationId: string): Promise<void> {
    if (!this.server) return;
    try {
      const tenantId = await this.tenantIdOfConversation(conversationId);
      await this.server.in(userRoom(tenantId, userId, tenantAls.getStore()?.spaceId)).socketsLeave(conversationRoom(tenantId, conversationId, tenantAls.getStore()?.spaceId));
    } catch (error) {
      this.logger.warn(`Không đẩy được socket của user ${userId} khỏi conversation ${conversationId}: ${(error as Error).message}`);
    }
  }


  private presenceSubject(tenantId: string | null | undefined, userId: string): string {
    return `${tenantRealtimeSegment(tenantId, tenantAls.getStore()?.spaceId)}:${userId}`;
  }

  async markConnected(tenantId: string | null, userId: string, socketId: string): Promise<void> {
    const subject = this.presenceSubject(tenantId, userId);
    this.trackLocalSocket(subject, socketId);
    try {
      const redis = this.state();
      const size = await redis.sadd(`${PRESENCE_KEY_PREFIX}${subject}`, socketId);
      await redis.expire(`${PRESENCE_KEY_PREFIX}${subject}`, this.presenceTtlSeconds);
      if (size === 1 && (await redis.scard(`${PRESENCE_KEY_PREFIX}${subject}`)) === 1) {
        await this.broadcastPresence(userId, true);
      }
    } catch (error) {
      this.logger.warn(`Không ghi được presence khi nối: ${(error as Error).message}`);
    }
  }

  async markDisconnected(tenantId: string | null, userId: string, socketId: string, broadcast = true): Promise<void> {
    const subject = this.presenceSubject(tenantId, userId);
    this.untrackLocalSocket(subject, socketId);
    try {
      const redis = this.state();
      await redis.srem(`${PRESENCE_KEY_PREFIX}${subject}`, socketId);
      const remaining = await redis.scard(`${PRESENCE_KEY_PREFIX}${subject}`);
      if (remaining === 0 && broadcast) await this.broadcastPresence(userId, false);
    } catch (error) {
      this.logger.warn(`Không ghi được presence khi ngắt: ${(error as Error).message}`);
    }
  }

  async listOnlineCoMemberIds(viewerId: string): Promise<string[]> {
    try {
      const conversations = await this.repo.listConversationsForUser(viewerId);
      if (!conversations.length) return [];
      const blockedCounterparts = new Set(await this.repo.listBlockedCounterpartIds(viewerId));
      const segmentsByUser = new Map<string, Set<string>>();
      for (const c of conversations) {
        const members = await this.repo.listMembers(c.id);
        let others = members.filter((id) => id !== viewerId);
        if (c.type === 1 && blockedCounterparts.size > 0) {
          others = others.filter((id) => !blockedCounterparts.has(id));
        }
        if (!others.length) continue;
        const segment = tenantRealtimeSegment(c.tenantId, tenantAls.getStore()?.spaceId);
        for (const id of others) {
          let segments = segmentsByUser.get(id);
          if (!segments) {
            segments = new Set();
            segmentsByUser.set(id, segments);
          }
          segments.add(segment);
        }
      }
      if (!segmentsByUser.size) return [];
      const pairs: { userId: string; key: string }[] = [];
      for (const [userId, segments] of segmentsByUser) {
        for (const segment of segments) {
          pairs.push({ userId, key: `${PRESENCE_KEY_PREFIX}${segment}:${userId}` });
        }
      }
      const pipeline = this.state().pipeline();
      for (const pair of pairs) pipeline.exists(pair.key);
      const results = await pipeline.exec();
      const online = new Set<string>();
      pairs.forEach((pair, index) => {
        const entry = results?.[index];
        if (entry && !entry[0] && entry[1] === 1) online.add(pair.userId);
      });
      return [...online];
    } catch (error) {
      this.logger.warn(`Không đọc được ảnh chụp presence cho ${viewerId}: ${(error as Error).message}`);
      return [];
    }
  }

  private trackLocalSocket(subject: string, socketId: string): void {
    let sockets = this.localPresence.get(subject);
    if (!sockets) {
      sockets = new Set();
      this.localPresence.set(subject, sockets);
    }
    sockets.add(socketId);
    if (!this.presenceTimer) {
      this.presenceTimer = setInterval(() => { void this.refreshLocalPresence(); }, this.presenceRefreshMs);
      this.presenceTimer.unref();
    }
  }

  private untrackLocalSocket(subject: string, socketId: string): void {
    const sockets = this.localPresence.get(subject);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.localPresence.delete(subject);
  }

  private async refreshLocalPresence(): Promise<void> {
    if (this.localPresence.size === 0) return;
    try {
      const redis = this.state();
      await Promise.all([...this.localPresence.keys()].map(async (subject) => {
        await redis.expire(`${PRESENCE_KEY_PREFIX}${subject}`, this.presenceTtlSeconds);
      }));
    } catch (error) {
      this.logger.warn(`Không gia hạn được presence: ${(error as Error).message}`);
    }
  }

  private async broadcastPresence(userId: string, online: boolean): Promise<void> {
    if (!this.server) return;
    try {
      const conversations = await this.repo.listConversationsForUser(userId);
      if (!conversations.length) return;
      const blockedCounterparts = new Set(await this.repo.listBlockedCounterpartIds(userId));
      const rooms: string[] = [];
      for (const c of conversations) {
        if (c.type === 1 && blockedCounterparts.size > 0) {
          const members = await this.repo.listMembers(c.id);
          const other = members.find((id) => id !== userId);
          if (other && blockedCounterparts.has(other)) continue;
        }
        rooms.push(conversationRoom(c.tenantId, c.id, tenantAls.getStore()?.spaceId));
      }
      if (!rooms.length) return;
      this.server
        .to(rooms)
        .emit(MESSAGING_SOCKET_EVENTS.presenceChanged, { userId, online });
    } catch (error) {
      this.logger.warn(`Không phát được presence: ${(error as Error).message}`);
    }
  }


  async noteTyping(conversationId: string, userId: string): Promise<void> {
    if (!this.server) return;
    try {
      const tenantId = await this.tenantIdOfConversation(conversationId);
      const set = await this.state().set(`${TYPING_KEY_PREFIX}${tenantRealtimeSegment(tenantId, tenantAls.getStore()?.spaceId)}:${conversationId}:${userId}`, '1', 'EX', TYPING_TTL_SECONDS, 'NX');
      if (set !== 'OK') return;
      this.server.to(conversationRoom(tenantId, conversationId, tenantAls.getStore()?.spaceId)).emit(MESSAGING_SOCKET_EVENTS.typing, { conversationId, userId });
    } catch (error) {
      this.logger.warn(`Không phát được typing: ${(error as Error).message}`);
    }
  }
}
