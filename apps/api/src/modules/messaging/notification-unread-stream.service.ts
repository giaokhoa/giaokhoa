import { Inject, Injectable, Logger, type MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { redisTlsFromUrl } from '../../config/env';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';
import { tenantAls } from '../tenants/tenant-als';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';

/**
 * Kênh Redis pub/sub mang tín hiệu "số thông báo chưa đọc của một user vừa thay đổi". Payload chỉ là userId — số đếm thật luôn được đọc lại từ database ở phía nhận, không tin số mang theo tín hiệu.
 */
export const NOTIFICATION_UNREAD_CHANGED_CHANNEL = 'giaokhoa:notifications:unread-changed';

/** Chỉ báo thay đổi, không mang dữ liệu hoặc số đếm của người nhận. */
interface UnreadSignal { userId: string; spaceId: string | null }

/** Ngữ cảnh đã xác thực của một SSE subscriber tại lúc kết nối. */
interface UnreadSubscriber {
  subject: Subject<MessageEvent>;
  tenantId: string | null;
  spaceSlug: string | null;
  spaceId: string | null;
}

/** Khoá local theo cả database; UUID của hai kho có thể trùng nhau. */
function unreadScopeKey(userId: string, spaceId: string | null): string {
  return `${spaceId ?? 'shared'}:${userId}`;
}

/** Nhịp heartbeat của stream: đủ dày để giữ kết nối SSE sống qua giới hạn idle của các chặng proxy ở biên. */
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Stream thời gian thực cho số thông báo chưa đọc (SSE).
 *
 * Thông báo có thể được tạo từ bất kỳ tiến trình nào (API khi xử lý
 * request, worker khi chạy job nền như cấp huy hiệu) nên tín hiệu thay
 * đổi đi qua Redis pub/sub làm backplane: nơi thay đổi số đếm gọi
 * {@link signalUnreadCountChanged}, mọi tiến trình API đang giữ stream
 * của user đó đều nhận tín hiệu, đọc lại số thật từ DB rồi đẩy xuống.
 * Kết nối subscriber phải là một connection Redis riêng (connection đã
 * subscribe không publish được), tách khỏi connection publish.
 */
@Injectable()
export class NotificationUnreadStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationUnreadStreamService.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  /** Các stream SSE đang mở trong tiến trình này, theo user. */
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
        // Tín hiệu legacy chỉ mang userId là của kho chung; không
        // bao giờ chuyển nó sang stream của một kho riêng.
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

  /**
   * Phát tín hiệu số đếm của user đã đổi. Lỗi Redis bị nuốt lặng: đẩy
   * thời gian thực là đường phụ, không bao giờ được làm hỏng nghiệp vụ
   * tạo/đánh dấu thông báo vốn đã ghi xong xuống DB.
   */
  async signalUnreadCountChanged(userId: string): Promise<void> {
    try {
      const spaceId = tenantAls.getStore()?.spaceId ?? null;
      await this.publisher.publish(NOTIFICATION_UNREAD_CHANGED_CHANNEL, JSON.stringify({ userId, spaceId } satisfies UnreadSignal));
    } catch {
      // Bỏ qua: client vẫn còn số khởi tạo từ REST và snapshot khi nối lại.
    }
  }

  /**
   * Mở stream cho một user: sự kiện đầu tiên là snapshot số hiện tại
   * đọc từ DB (mỗi lần nối — kể cả EventSource tự nối lại — đều đồng bộ
   * lại từ đầu), sau đó là mỗi thay đổi được đẩy xuống, kẹp heartbeat
   * giữ kết nối. Ngắt kết nối thì gỡ đăng ký, không rò listener.
   */
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

      // Snapshot ở ALS request đã được xác thực (gồm database và GUC).
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

  /**
   * Lấy số đếm trong từng miền SSE đã mở, không dùng lại handle
   * database của lần pub/sub (callback Redis không có ALS request).
   * Nếu sổ không còn khớp với danh tính của stream, từ chối đẩy
   * dữ liệu thay vì đổi im lặng sang kho mới hoặc kho chung.
   */
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
