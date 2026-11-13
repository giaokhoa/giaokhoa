import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
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

@Injectable()
export class SpaceDatabaseService implements OnModuleDestroy {
  private readonly resolver: SpaceConnectionResolver;
  private readonly poolMax: number;
  private readonly sweepConcurrency: number;
  private readonly ssl: boolean;
  private readonly registryPool: Pool | null;
  private readonly registryDb: ControlPlaneDb | null;
  private readonly dedicatedSlugs = new Set<string>();

  private sharedKysely: CentreDb | null = null;

  private sharedPool: { end(): Promise<void> } | null = null;



  private readonly preparedKysely = new Map<string, { db: CentreDb; databaseName: string; spaceId: string }>();
  private readonly kyselyPools: SpacePoolManager<CentreDb>;

  readonly routedKysely: CentreDb;

  constructor(config: ConfigService) {
    this.poolMax = config.get<number>('SPACE_DB_POOL_MAX') ?? 3;
    this.sweepConcurrency = config.get<number>('SPACE_SWEEP_CONCURRENCY') ?? 3;
    this.ssl = config.get<boolean>('DATABASE_SSL') ?? false;
    const idleTimeoutMs = config.get<number>('SPACE_DB_POOL_IDLE_TIMEOUT_MS') ?? 60_000;
    const registryUrl = config.get<string>('CONTROL_PLANE_DATABASE_URL');
    if (registryUrl) {
      const connection = databaseConnectionFromEnv(registryUrl, this.ssl);
      this.registryPool = new Pool(
        typeof connection === 'string' ? { connectionString: connection } : connection,
      );
      this.registryPool.on('error', (error: Error) => new Logger(SpaceDatabaseService.name).error(`Kết nối control plane nhàn rỗi bị lỗi: ${error.message}`));
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
      maxPools: config.get<number>('SPACE_DB_MAX_POOLS') ?? 6,
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
  bindSharedKysely(db: CentreDb, pool?: { end(): Promise<void> }): void {
    this.sharedKysely = db;
    this.sharedPool = pool ?? null;
  }

  async resolveTarget(slug: string): Promise<ResolvedSpaceConnection> {
    return this.resolver.resolve(slug);
  }

  invalidate(slug?: string): void {
    this.resolver.invalidate(slug);
  }

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

  preparedSpaceScope(slug: string, expectedDb?: CentreDb): Pick<TenantAlsStore, 'spaceId' | 'spaceHandle'> {
    const prepared = this.preparedKysely.get(slug);
    if (!prepared || (expectedDb && prepared.db !== expectedDb)) {
      throw new SpaceRoutingError('space_routing.prepared_revoked', `Space ${slug} was re-prepared or revoked`);
    }
    return this.dedicatedSlugs.has(slug)
      ? { spaceId: prepared.spaceId, spaceHandle: prepared.db }
      : {};
  }

  async withSpaceKysely<T>(
    slug: string,
    fn: (db: CentreDb) => Promise<T>,
    context?: { tenantId?: string; userId?: string },
  ): Promise<T> {
    const db = await this.getKyselyForSpace(slug);
    const prepared = this.preparedKysely.get(slug);
    if (!prepared || prepared.db !== db) {
      throw new SpaceRoutingError('space_routing.prepared_revoked', `Space ${slug} was re-prepared before its session started`);
    }
    const parent = tenantAls.getStore();
    const spaceId = this.dedicatedSlugs.has(slug) ? prepared.spaceId : undefined;
    if (this.dedicatedSlugs.has(slug) && !spaceId) throw new SpaceRoutingError('space_routing.not_prepared', `Space ${slug} has no prepared identity`);
    if (parent?.spaceSlug === slug && (parent.spaceId || parent.spaceHandle)
      && (parent.spaceId !== spaceId || parent.spaceHandle !== (this.dedicatedSlugs.has(slug) ? db : undefined))) {
      throw new SpaceRoutingError('space_routing.prepared_identity_mismatch', `Space ${slug} changed while opening a nested session`);
    }
    const store: TenantAlsStore = {
      ...parent, ...context, spaceSlug: slug, spaceId,
      spaceHandle: this.dedicatedSlugs.has(slug) ? db : undefined,
    };
    if (context?.tenantId) store.platform = false;
    return tenantAls.run(store, async () => fn(db));
  }

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

  async sweepSharedAndDedicated<T>(
    sweep: () => Promise<T>,
    merge: (result: T, next: T) => T,
  ): Promise<T> {
    const failed: string[] = [];
    let shared: T | undefined;
    try {
      shared = await tenantAls.run({ platform: true }, sweep);
    } catch (error) {
      failed.push(`shared: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    return results.reduce<T>((all, value) => merge(all, value as T), shared as T);
  }

  private requireSharedKysely(): CentreDb {
    if (!this.sharedKysely) {
      throw new SpaceRoutingError(
        'space_routing.shared_not_bound',
        'Shared Kysely database handle is not bound yet',
      );
    }
    return this.sharedKysely;
  }

  private currentKysely(): CentreDb {
    const scope = tenantAls.getStore();
    const slug = scope?.spaceSlug;
    if (slug) {
      const preparedEntry = this.preparedKysely.get(slug);
      if (preparedEntry) {
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

  async onModuleDestroy(): Promise<void> {
    this.resolver.dispose();
    await this.kyselyPools.closeAll();
    await this.sharedPool?.end();
    await this.registryPool?.end().catch(() => undefined);
  }
}
