import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { createControlPlaneKysely, type ControlPlaneDb } from '@giaokhoa/db/control-plane';
import { databaseConnectionFromEnv } from '../../config/env';
import { tenantAls, type TenantAlsStore } from '../tenant-als';
import { TenantAwarePool } from '../tenant-pool';
import {
  SpaceConnectionResolver,
  SpaceRoutingError,
  type ResolvedSpaceConnection,
  type SpaceRegistryEntry,
} from './space-connection-resolver';
import { SpacePoolManager } from './space-pool-manager';
import { mapWithConcurrencyLimit } from './space-sweep';

/**
 * Khung định tuyến kết nối theo trung tâm cho tác vụ nền (issue
 * #581) — BẢN SAO phía worker của
 * `apps/api/src/db/routing/space-database.service.ts` theo tiền lệ
 * repo (mỗi app giữ bản sao hạ tầng riêng — cùng khuôn với
 * `tenant-als`/`tenant-pool`): hai tiến trình không dùng chung bộ
 * nhớ, nên mỗi phía giữ bộ phân giải, trình quản lý pool và bảng
 * đã-chuẩn-bị của riêng mình, cùng đọc MỘT sổ đăng ký ở control
 * plane và cùng một luật phân giải. Sửa file này PHẢI sửa đồng bộ
 * bản phía API và ngược lại.
 *
 * Ba điểm khác bản API, đều do hình của tiến trình worker:
 * - Worker chưa có kết nối control plane dùng chung, nên service
 *   tự giữ MỘT pool đọc sổ riêng từ cùng biến
 *   `CONTROL_PLANE_DATABASE_URL` (chỉ đọc dòng đăng ký qua handle
 *   Kysely của adapter control plane, như bản API đọc qua
 *   `ControlPlaneConnection`; biến chưa cấu hình thì phân giải
 *   ném `space_routing.not_configured` — các đường kho chung không
 *   qua khung này nên worker vẫn chạy như cũ khi chưa cấu hình).
 * - Từ issue #582, handle mà các processor/service dùng là handle
 *   định tuyến (`routedKysely`, gắn ở `worker.module.ts`): ngữ
 *   cảnh không mang slug của một trung tâm đã chuẩn bị ở kho riêng
 *   thì handle uỷ thác về handle kho chung, nên mọi đường chưa qua
 *   phiên theo trung tâm chạy đúng như hiện tại; phiên theo trung
 *   tâm cho job được mở qua
 *   `SpaceJobRunner`/`withSpaceKysely(slug, fn)`.
 * - Chỉ bản worker có `listRegisteredSpaces`: relay outbox quét
 *   thêm outbox của từng trung tâm ở kho riêng theo danh sách
 *   này (issue #582); phía API không có đường quét tương đương
 *   nên không cần hàm này.
 *
 * Kỷ luật pool và GUC giống hệt phía API: pool theo database tạo
 * lười, có trần, đóng khi nhàn rỗi; pool kho riêng cũng là
 * `TenantAwarePool` để chính sách RLS tiếp tục fail-closed theo
 * tenant của ngữ cảnh; không kết nối "siêu quyền" cho đường nền.

 */
@Injectable()
export class SpaceDatabaseService implements OnModuleDestroy {
  private readonly resolver: SpaceConnectionResolver;
  private readonly poolMax: number;
  /** Trần kho chạy song song của lượt quét định kỳ (dùng chung cấu hình với outbox relay). */
  private readonly sweepConcurrency: number;
  private readonly ssl: boolean;
  /** Pool đọc sổ đăng ký ở control plane; null khi worker chưa cấu hình biến kết nối control plane. */
  private readonly registryPool: Pool | null;
  /** Handle Kysely đọc sổ — dựng trên `registryPool` qua factory của adapter control plane. */
  private readonly registryDb: ControlPlaneDb | null;
  /**
   * Các slug mà lần chuẩn bị gần nhất kết luận đang ở chế độ KHO RIÊNG — cùng vai trò với bản phía API: bảng này KHÔNG bị `onPoolClosed` xoá theo mục đã-chuẩn-bị, để `currentKysely` phân biệt "slug chưa từng chuẩn bị" (được rơi về kho chung theo hợp đồng) với "slug đã chuẩn bị ở kho riêng nhưng mục đã-chuẩn-bị đã bị thu hồi" (phải fail-closed). Mục của một slug bị xoá khi lần chuẩn bị sau kết luận slug đó ở kho chung.
   */
  private readonly dedicatedSlugs = new Set<string>();

  /**
   * Handle Kysely của kho chung cho đường định tuyến; null cho tới khi được gắn — `worker.module.ts` gắn nó bằng cùng pool kho chung lúc khởi động. Instance này KHÔNG được `destroy()` riêng
   * (huỷ nó sẽ đóng luôn pool chung) — vòng đời của nó đi theo
   * vòng đời pool.
   */
  private sharedKysely: CentreDb | null = null;
  /**
   * Các trung tâm đã chuẩn bị xong: slug → handle + kho của handle. Đây là bảng tra ĐỒNG BỘ mà `routedKysely` dùng tại thời điểm mỗi lần gọi — phân giải (đọc sổ, mở pool) là thao tác bất đồng bộ nên phải xong từ bước chuẩn bị, không thể chen vào đường đồng bộ của một lần truy vấn.
   */
  private readonly preparedKysely = new Map<string, { db: CentreDb; databaseName: string; spaceId: string }>();
  /**
   * Trình quản lý pool cho các handle Kysely của kho riêng (tạo lười, trần theo kho, đóng khi nhàn rỗi, thay pool khi danh tính kết nối đổi).
   */
  private readonly kyselyPools: SpacePoolManager<CentreDb>;

  /**
   * Handle định tuyến Kysely theo ngữ cảnh — hợp đồng chuẩn bị-trước và fail-closed như phía API: ngữ cảnh mang slug chưa từng chuẩn bị thì về kho chung; slug đã chuẩn bị ở kho riêng mà mục đã-chuẩn-bị đã bị thu hồi thì ném `SpaceRoutingError`, không rơi im lặng về kho chung. Ngữ nghĩa uỷ thác qua Proxy được chứng minh bằng spec `routed-kysely` phía worker (transaction, getter `schema`, builder lười).
   */
  readonly routedKysely: CentreDb;

  constructor(config: ConfigService) {
    this.poolMax = config.get<number>('SPACE_DB_POOL_MAX') ?? 5;
    this.sweepConcurrency = config.get<number>('SPACE_SWEEP_CONCURRENCY') ?? 3;
    this.ssl = config.get<boolean>('DATABASE_SSL') ?? false;
    const idleTimeoutMs = config.get<number>('SPACE_DB_POOL_IDLE_TIMEOUT_MS') ?? 60_000;
    const registryUrl = config.get<string>('CONTROL_PLANE_DATABASE_URL');
    if (registryUrl) {
      const connection = databaseConnectionFromEnv(registryUrl, this.ssl);
      this.registryPool = new Pool(
        typeof connection === 'string' ? { connectionString: connection } : connection,
      );
      this.registryDb = createControlPlaneKysely(this.registryPool);
    } else {
      this.registryPool = null;
      this.registryDb = null;
    }
    this.resolver = new SpaceConnectionResolver({
      cacheTtlMs: config.get<number>('SPACE_ROUTING_CACHE_TTL_MS') ?? 5_000,
      readRegistry: async (slug) => {
        const db = this.registryDb;
        if (!db) {
          throw new SpaceRoutingError(
            'space_routing.not_configured',
            'Control plane database is not configured',
          );
        }
        const row = await db
          .selectFrom('space_registry')
          .select([
            'id',
            'slug',
            'status',
            'database_name as databaseName',
            'storage_mode as storageMode',
            'connection_role_ref as connectionRoleRef',
            'secret_ref as secretRef',
            'schema_version as schemaVersion',
          ])
          .where('slug', '=', slug)
          .limit(1)
          .executeTakeFirst();
        return row ?? undefined;
      },
    });
    this.kyselyPools = new SpacePoolManager<CentreDb>({
      idleTimeoutMs,
      // Pool của một kho bị gỡ (đóng vì nhàn rỗi, hoặc bị thay vì sổ đổi danh tính kết nối) thì các trung tâm trỏ vào kho đó cũng hết trạng thái "đã chuẩn bị": handle của pool đã chết không còn được dùng. Việc chuẩn bị lại diễn ra ở lần gọi `getKyselyForSpace`/`withSpaceKysely` kế tiếp; riêng đường ĐỒNG BỘ của `routedKysely` không chuẩn bị lại được, nên với slug đã chuẩn bị ở kho riêng nó fail-closed (xem `dedicatedSlugs` và `currentKysely`) thay vì chạm vào handle đã chết hoặc rơi về kho chung.
      onPoolClosed: (databaseName) => {
        for (const [slug, entry] of [...this.preparedKysely]) {
          if (entry.databaseName === databaseName) this.preparedKysely.delete(slug);
        }
      },
    });
    this.kyselyPools.startIdleSweeper(Math.min(30_000, Math.max(1_000, Math.floor(idleTimeoutMs / 2))));
    this.routedKysely = this.createRoutedHandle(() => this.currentKysely());
  }

  /**
   * Gắn handle Kysely kho chung — `worker.module.ts` gọi đúng một lần lúc khởi động, bằng handle dựng trên pool kho chung. Mọi đích `shared` và mọi ngữ cảnh chưa chuẩn bị trung tâm riêng đều uỷ thác về handle này qua `routedKysely`.
   */
  bindSharedKysely(db: CentreDb): void {
    this.sharedKysely = db;
  }

  /** Phân giải đích kết nối của một trung tâm (không mở pool). */
  async resolveTarget(slug: string): Promise<ResolvedSpaceConnection> {
    return this.resolver.resolve(slug);
  }

  /** Xoá đệm phân giải của một slug (hoặc toàn bộ). */
  invalidate(slug?: string): void {
    this.resolver.invalidate(slug);
  }

  /**
   * Lấy handle Kysely của một trung tâm theo slug — bước chuẩn bị
   * của mọi đường định tuyến:
   * - Trung tâm ở kho chung: trả chính handle Kysely kho chung đã
   *   gắn (qua `bindSharedKysely`).
   * - Trung tâm ở kho riêng: lấy (hoặc tạo lười) pool của kho đó từ
   *   trình quản lý pool — pool nối bằng đúng role của kho, trần
   *   kết nối theo cấu hình `SPACE_DB_POOL_MAX`. Pool được lấy
   *   THEO DANH TÍNH kết nối vừa phân giải: nếu sổ đã đổi
   *   role/bí mật kể từ khi pool được tạo, trình quản lý pool thay
   *   pool cũ bằng pool mới đúng danh tính hiện hành (xem
   *   `SpacePoolManager.getHandleForIdentity`) — handle trả về
   *   luôn kết nối bằng danh tính sổ chốt ở lần chuẩn bị này.
   * Kết quả được ghi vào bảng đã-chuẩn-bị để `routedKysely` tra
   * đồng bộ khi ngữ cảnh mang slug này; chế độ kho của lần chuẩn
   * bị này cũng được ghi vào `dedicatedSlugs` (chỉ khi là kho
   * riêng) cho đường đồng bộ.
   *
   * @throws SpaceRoutingError khi slug chưa đăng ký, control plane
   *   chưa cấu hình, hoặc bí mật/role của kho riêng lệch sổ đăng ký.
   */
  async getKyselyForSpace(slug: string): Promise<CentreDb> {
    const target = await this.resolver.resolve(slug);
    if (target.mode === 'shared') {
      const db = this.requireSharedKysely();
      this.preparedKysely.set(slug, { db, databaseName: target.databaseName, spaceId: target.spaceId });
      this.dedicatedSlugs.delete(slug);
      return db;
    }
    const connectionString = target.connectionString;
    if (!connectionString) {
      throw new SpaceRoutingError(
        'space_routing.secret_missing',
        `Resolved dedicated target for space ${slug} has no connection string`,
      );
    }
    const handle = this.kyselyPools.getHandleForIdentity(target.databaseName, connectionString, (databaseName) => {
      const connection = databaseConnectionFromEnv(connectionString, this.ssl);
      const pool = new TenantAwarePool(
        typeof connection === 'string'
          ? { connectionString: connection, max: this.poolMax }
          : { ...connection, max: this.poolMax },
      );
      return { databaseName, pool, db: createCentreKysely(pool) };
    });
    this.preparedKysely.set(slug, { db: handle.db, databaseName: target.databaseName, spaceId: target.spaceId });
    this.dedicatedSlugs.add(slug);
    return handle.db;
  }

  /** Lấy binding bất biến của handle đã chuẩn bị, không đọc lại control plane. */
  preparedSpaceScope(slug: string, expectedDb?: CentreDb): Pick<TenantAlsStore, 'spaceId' | 'spaceHandle'> {
    const prepared = this.preparedKysely.get(slug);
    if (!prepared || (expectedDb && prepared.db !== expectedDb)) {
      throw new SpaceRoutingError('space_routing.prepared_revoked', `Space ${slug} was re-prepared or revoked`);
    }
    return this.dedicatedSlugs.has(slug)
      ? { spaceId: prepared.spaceId, spaceHandle: prepared.db }
      : {};
  }

  /**
   * Mở phiên làm việc theo trung tâm cho một tác vụ nền: chuẩn bị
   * handle của trung tâm rồi chạy `fn` trong ngữ cảnh ALS mang
   * slug của trung tâm (hợp thêm tenant/user của tác vụ nếu
   * truyền; truyền tenant thì ngữ cảnh thôi là đường platform).
   * Scheduler/processor gọi đường này khi job mang định danh trung
   * tâm — từ issue #582 qua `SpaceJobRunner` ở các processor tiêu
   * thụ job outbox, và trực tiếp ở lượt quét outbox theo trung
   * tâm của relay.
   */
  async withSpaceKysely<T>(
    slug: string,
    fn: (db: CentreDb) => Promise<T>,
    context?: { tenantId?: string; userId?: string },
  ): Promise<T> {
    const db = await this.getKyselyForSpace(slug);
    // Một request khác có thể chuẩn bị lại CÙNG slug giữa await
    // trên và lúc ghim ALS: không lấy spaceId của handle B cho db A.
    const prepared = this.preparedKysely.get(slug);
    if (!prepared || prepared.db !== db) {
      throw new SpaceRoutingError('space_routing.prepared_revoked', `Space ${slug} was re-prepared before its session started`);
    }
    const parent = tenantAls.getStore();
    // Ghim danh tính bất biến của dòng sổ đã chuẩn bị vào cùng phiên;
    // mọi Redis key và room bên dưới dùng chính giá trị này.
    const spaceId = this.dedicatedSlugs.has(slug) ? prepared.spaceId : undefined;
    if (this.dedicatedSlugs.has(slug) && !spaceId) throw new SpaceRoutingError('space_routing.not_prepared', `Space ${slug} has no prepared identity`);
    // Một handler A có thể tự gọi withSpaceKysely(A) lần nữa sau
    // khi registry đổi D1 -> D2. Không để wrapper lồng nhau biến
    // lượt đọc của phiên A cũ thành một phiên B mới cùng slug.
    if (parent?.spaceSlug === slug && (parent.spaceId || parent.spaceHandle)
      && (parent.spaceId !== spaceId || parent.spaceHandle !== (this.dedicatedSlugs.has(slug) ? db : undefined))) {
      throw new SpaceRoutingError('space_routing.prepared_identity_mismatch', `Space ${slug} changed while opening a nested session`);
    }
    const store: TenantAlsStore = {
      ...parent, ...context, spaceSlug: slug, spaceId,
      spaceHandle: this.dedicatedSlugs.has(slug) ? db : undefined,
    };
    if (context?.tenantId) store.platform = false;
    // Bọc `fn` trong một hàm async ngay bên trong `run` — cùng lý
    // do với bản phía API: việc thực thi truy vấn chỉ bắt đầu tại
    // điểm await quyết định ngữ cảnh ALS, điểm await đó phải nằm
    // trong `run` thì GUC tenant mới được gắn đúng khi kết nối
    // checkout.
    return tenantAls.run(store, async () => fn(db));
  }

  /**
   * Toàn bộ dòng đăng ký không gian ở dạng bộ phân giải cần — chỉ
   * bản worker có hàm này (xem mô tả lớp): relay outbox dùng để
   * quét thêm outbox của từng trung tâm ở kho riêng ở mỗi nhịp
   * (issue #582). Chưa cấu hình control plane thì trả danh sách
   * rỗng — không có trung tâm nào để quét, các đường kho chung
   * không bị ảnh hưởng.
   */
  async listRegisteredSpaces(): Promise<SpaceRegistryEntry[]> {
    const db = this.registryDb;
    if (!db) return [];
    const rows = await db
      .selectFrom('space_registry')
      .select([
        'id',
        'slug',
        'status',
        'database_name as databaseName',
        'storage_mode as storageMode',
        'connection_role_ref as connectionRoleRef',
        'secret_ref as secretRef',
        'schema_version as schemaVersion',
      ])
      .execute();
    return rows;
  }

  /**
   * Quét dữ liệu định kỳ trong kho chung RỒI từng kho riêng đang active.
   * Danh sách registry và identity được xác minh lại trước mỗi lượt;
   * sau bước chuẩn bị pool còn kiểm tra `spaceId` trong ALS để chặn
   * việc slug bị gán lại trong lúc tác vụ đang thực thi. Một kho lỗi
   * không cản các kho khác; SAU khi quét hết mới ném lỗi tổng hợp để
   * BullMQ retry (không được trả thành công giả khi còn kho bỏ sót).
   * Mỗi lần retry đều quét lại: tác vụ nghiệp vụ tự chống trùng qua
   * khóa/đánh dấu bền, cùng nguyên tắc at-least-once của relay.
   */
  async sweepSharedAndDedicated<T>(
    sweep: () => Promise<T>,
    merge: (result: T, next: T) => T,
  ): Promise<T> {
    const failed: string[] = [];
    let shared: T | undefined;
    try {
      shared = await tenantAls.run({ platform: true }, sweep);
    } catch (error) {
      // Kho chung lỗi không được chặn kho riêng; vẫn chạy các kho
      // còn lại rồi ném lỗi để retry TOÀN BỘ lượt quét.
      failed.push(`shared: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Không được thay lỗi đọc sổ bằng danh sách rỗng: khi control
    // plane mất, retry phải giữ trạng thái failed, không được thông
    // báo đã xử lý hết kho riêng.
    const registered = await this.listRegisteredSpaces();
    const dedicated = registered.filter((space) => space.storageMode === 'dedicated' && space.status === 'active');
    const results: Array<T | undefined> = Array.from({ length: dedicated.length });
    await mapWithConcurrencyLimit(dedicated.map((space, index) => ({ space, index })), this.sweepConcurrency, async ({ space, index }) => {
      try {
        const target = await this.resolveTarget(space.slug);
        if (target.mode !== 'dedicated' || target.status !== 'active' || target.spaceId !== space.id) {
          throw new SpaceRoutingError('space_routing.sweep_identity_mismatch', `Space identity changed for ${space.slug}`);
        }
        results[index] = await tenantAls.run({ platform: true }, () =>
          this.withSpaceKysely(space.slug, async () => {
            const prepared = await this.resolveTarget(space.slug);
            if (tenantAls.getStore()?.spaceId !== space.id || prepared.spaceId !== space.id
              || prepared.mode !== 'dedicated' || prepared.status !== 'active') {
              throw new SpaceRoutingError('space_routing.sweep_identity_mismatch', `Prepared identity changed for ${space.slug}`);
            }
            return sweep();
          }),
        );
      } catch (error) {
        failed.push(`${space.slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    if (failed.length > 0) {
      throw new Error(`Periodic sweep failed in ${failed.length} storage scope(s): ${failed.join('; ')}`);
    }
    // Dùng reduce không bỏ qua kết quả rỗng/false/0; chỉ bỏ qua
    // undefined do lỗi và lỗi đã ném ở trên.
    return results.reduce<T>((all, value) => merge(all, value as T), shared as T);
  }

  /** Handle Kysely kho chung đã gắn; chưa gắn là lỗi lập trình ở đường khởi động. */
  private requireSharedKysely(): CentreDb {
    if (!this.sharedKysely) {
      throw new SpaceRoutingError(
        'space_routing.shared_not_bound',
        'Shared Kysely database handle is not bound yet',
      );
    }
    return this.sharedKysely;
  }

  /**
   * Handle hiệu lực cho ngữ cảnh hiện tại — cùng hợp đồng với bản
   * phía API: slug chưa từng chuẩn bị ở kho riêng thì về kho
   * chung; slug đã chuẩn bị ở kho riêng mà mục đã-chuẩn-bị đã bị
   * thu hồi (pool đóng vì nhàn rỗi hoặc bị thay vì đổi danh tính)
   * thì ném `SpaceRoutingError`
   * (`space_routing.prepared_revoked`) — fail-closed, tuyệt đối
   * không rơi im lặng về kho chung; bên gọi chuẩn bị lại qua
   * `getKyselyForSpace`/`withSpaceKysely` rồi thử lại.
   */
  private currentKysely(): CentreDb {
    const scope = tenantAls.getStore();
    const slug = scope?.spaceSlug;
    if (slug) {
      const preparedEntry = this.preparedKysely.get(slug);
      if (preparedEntry) {
        // Mỗi lần dựng query builder (kể cả sau một await dài) phải
        // kiểm tra identity của handle so với phiên đã ghim. Slug
        // có thể được chuẩn bị lại sang B bởi request khác khi phiên
        // A vẫn sống; chỉ tra slug sẽ làm callback A đọc/ghi B.
        // Nếu dedicated chuyển thành shared, cũng không được rơi về
        // kho chung dù registry vẫn giữ nguyên ID. Phiên dedicated
        // thiếu `spaceId` cũng phải từ chối, không được dùng handle
        // hiện tại theo slug khi identity phiên chưa được xác thực.
        // Cùng spaceId nhưng database/role/secret đổi cũng thay handle:
        // tuyệt đối không nhận handle mới trong phiên đã ghim cái cũ.
        if ((this.dedicatedSlugs.has(slug) && (!scope?.spaceId || preparedEntry.spaceId !== scope.spaceId
          || scope.spaceHandle !== preparedEntry.db))
          || (!this.dedicatedSlugs.has(slug) && (!!scope?.spaceId || !!scope?.spaceHandle))) {
          throw new SpaceRoutingError(
            'space_routing.prepared_identity_mismatch',
            `Space ${slug} was re-prepared for a different identity while the current scope was active`,
          );
        }
        return preparedEntry.db;
      }
      if (this.dedicatedSlugs.has(slug) || scope?.spaceId || scope?.spaceHandle) {
        throw new SpaceRoutingError(
          'space_routing.prepared_revoked',
          `Space ${slug} was prepared with a dedicated store but that preparation is no longer active; prepare the space again before routing queries to it`,
        );
      }
    }
    return this.requireSharedKysely();
  }

  /**
   * Dựng handle định tuyến — cùng cơ chế Proxy uỷ thác theo ngữ
   * cảnh với phía API: mỗi lần đọc thuộc tính đều lấy từ handle
   * hiệu lực của ngữ cảnh TẠI THỜI ĐIỂM ĐÓ và gắn hàm về đúng
   * handle đó (hàm trần không gắn sẽ mất `this` nội bộ của
   * handle).
   */
  private createRoutedHandle<TDatabase extends object>(current: () => TDatabase): TDatabase {
    return new Proxy({} as TDatabase, {
      get: (_target, property) => {
        const db = current();
        const value = Reflect.get(db as object, property, db);
        return typeof value === 'function' ? value.bind(db) : value;
      },
      has: (_target, property) => property in current(),
      ownKeys: () => Reflect.ownKeys(current()),
      getOwnPropertyDescriptor: (_target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(current(), property);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
    });
  }

  /** Kết thúc vòng đời: ngừng nghe sự kiện đổi sổ, đóng mọi pool kho riêng và pool đọc sổ. */
  async onModuleDestroy(): Promise<void> {
    this.resolver.dispose();
    await this.kyselyPools.closeAll();
    await this.registryPool?.end().catch(() => undefined);
  }
}
