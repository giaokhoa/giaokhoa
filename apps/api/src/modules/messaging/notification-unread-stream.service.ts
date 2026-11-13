import { Inject, Injectable, Logger, type MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { redisTlsFromUrl } from '../../config/env';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';
import { tenantAls } from '../tenants/tenant-als';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';

export const NOTIFICATION_UNREAD_CHANGED_CHANNEL = 'giaokhoa:notifications:unread-changed';

interface UnreadSignal { userId: string; spaceId: string | null }

interface UnreadSubscriber {
  subject: Subject<MessageEvent>;
  tenantId: string | null;
  spaceSlug: string | null;
  spaceId: string | null;
}

function unreadScopeKey(userId: string, spaceId: string | null): string {
  return `${spaceId ?? 'shared'}:${userId}`;
}

const HEARTBEAT_INTERVAL_MS = 25_000;

@Injectable()
export class NotificationUnreadStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationUnreadStreamService.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly streamsByUser = new Map<string, Set<UnreadSubscriber>>();

  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly repo: MessagingRepository,
    private readonly spaceDb: SpaceDatabaseService,
  ) {
    const redisUrl = config.getOrThrow<string>('REDIS_URL');
    const options = { maxRetriesPerRequest: null, ...redisTlsFromUrl(redisUrl) };
    this.publisher = new Redis(redisUrl, options);
    this.subscriber = new Redis(redisUrl, options);
  }

  async onModuleInit(): Promise<void> {
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== NOTIFICATION_UNREAD_CHANGED_CHANNEL) return;
      let signal: UnreadSignal;
      try {
        const decoded: unknown = JSON.parse(raw);
        if (!decoded || typeof decoded !== 'object') return;
        const value = decoded as Record<string, unknown>;
        if (typeof value.userId !== 'string' || !(value.spaceId === null || typeof value.spaceId === 'string')) return;
        signal = { userId: value.userId, spaceId: value.spaceId } as UnreadSignal;
      } catch {
        signal = { userId: raw, spaceId: null };
      }
      void this.pushCurrentCount(signal);
    });
    this.subscriber.on('error', (error: Error) => {
      this.logger.warn(`Redis subscriber của stream thông báo lỗi: ${error.message}`);
    });
    await this.subscriber.subscribe(NOTIFICATION_UNREAD_CHANGED_CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    for (const subjects of this.streamsByUser.values()) {
      for (const subscriber of subjects) subscriber.subject.complete();
    }
    this.streamsByUser.clear();
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }

  async signalUnreadCountChanged(userId: string): Promise<void> {
    try {
      const spaceId = tenantAls.getStore()?.spaceId ?? null;
      await this.publisher.publish(NOTIFICATION_UNREAD_CHANGED_CHANNEL, JSON.stringify({ userId, spaceId } satisfies UnreadSignal));
    } catch {
    }
  }

  streamUnreadCount(userId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const subject = new Subject<MessageEvent>();
      const store = tenantAls.getStore();
      const stream: UnreadSubscriber = {
        subject,
        tenantId: store?.tenantId ?? null,
        spaceSlug: store?.spaceSlug ?? null,
        spaceId: store?.spaceId ?? null,
      };
      const key = unreadScopeKey(userId, stream.spaceId);
      let subjects = this.streamsByUser.get(key);
      if (!subjects) {
        subjects = new Set();
        this.streamsByUser.set(key, subjects);
      }
      subjects.add(stream);
      const subscription = subject.subscribe(subscriber);

      void this.repo.countUnreadNotifications(userId, store?.tenantId).then(
        (unread) => { if (!subject.closed) subject.next({ type: 'unread-count', data: { unread } }); },
        () => undefined,
      );
      const heartbeat = setInterval(() => {
        if (!subject.closed) subject.next({ type: 'heartbeat', data: '' });
      }, HEARTBEAT_INTERVAL_MS);

      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        subjects.delete(stream);
        if (subjects.size === 0) this.streamsByUser.delete(key);
        subject.complete();
      };
    });
  }

  private async pushCurrentCount(signal: UnreadSignal): Promise<void> {
    const subjects = this.streamsByUser.get(unreadScopeKey(signal.userId, signal.spaceId));
    if (!subjects || subjects.size === 0) return;
    for (const stream of subjects) {
      if (stream.subject.closed) continue;
      try {
        const readCount = () => this.repo.countUnreadNotifications(signal.userId, stream.tenantId ?? undefined);
        let unread: number;
        if (stream.spaceSlug) {
          const target = await this.spaceDb.resolveTarget(stream.spaceSlug);
          if ((target.mode === 'dedicated' ? target.spaceId : null) !== stream.spaceId) {
            throw new Error('space_routing.stream_identity_changed');
          }
          unread = await this.spaceDb.withSpaceKysely(stream.spaceSlug, readCount, {
            tenantId: stream.tenantId ?? undefined,
          });
        } else {
          if (stream.spaceId) throw new Error('space_routing.stream_slug_missing');
          unread = await tenantAls.run(
            stream.tenantId ? { tenantId: stream.tenantId } : { platform: true },
            readCount,
          );
        }
        if (!stream.subject.closed) stream.subject.next({ type: 'unread-count', data: { unread } });
      } catch (error) {
        this.logger.warn(`Không đọc được số chưa đọc trong đúng kho SSE: ${(error as Error).message}`);
      }
    }
  }
}
