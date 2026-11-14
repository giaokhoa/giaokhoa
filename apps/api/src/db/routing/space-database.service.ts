import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { databaseConnectionFromEnv } from '../../config/env';
import { ControlPlaneConnection } from '../control-plane-connection.service';
import { tenantAls, type TenantAlsStore } from '../tenant-als';
import { TenantAwarePool } from '../tenant-pool';
import {
  SpaceConnectionResolver,
  SpaceRoutingError,
  type ResolvedSpaceConnection,
} from './space-connection-resolver';
import { SpacePoolManager } from './space-pool-manager';

@Injectable()
export class SpaceDatabaseService implements OnModuleDestroy {
  private readonly resolver: SpaceConnectionResolver;
  private readonly poolMax: number;
  private readonly ssl: boolean;
  private readonly dedicatedSlugs = new Set<string>();
  private readonly dedicatedDatabaseNames = new Map<string, string>();

  private sharedKysely: CentreDb | null = null;

  private sharedPool: { end(): Promise<void> } | null = null;



  private readonly preparedKysely = new Map<string, { db: CentreDb; databaseName: string; spaceId: string }>();
  private readonly kyselyPools: SpacePoolManager<CentreDb>;

  readonly routedKysely: CentreDb;

  constructor(config: ConfigService, controlPlane: ControlPlaneConnection) {
    this.poolMax = config.get<number>('SPACE_DB_POOL_MAX') ?? 3;
    this.ssl = config.get<boolean>('DATABASE_SSL') ?? false;
    const idleTimeoutMs = config.get<number>('SPACE_DB_POOL_IDLE_TIMEOUT_MS') ?? 60_000;
    this.resolver = new SpaceConnectionResolver({
      cacheTtlMs: config.get<number>('SPACE_ROUTING_CACHE_TTL_MS') ?? 5_000,
      readRegistry: async (slug) => {
        const db = controlPlane.kysely;
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

      onPoolCloseError: (databaseName, error) => {
        for (const [slug, entry] of [...this.preparedKysely]) {
          if (entry.databaseName === databaseName) this.preparedKysely.delete(slug);
        }
        new Logger(SpaceDatabaseService.name).error(
          'Không thể giải phóng pool kho riêng ' + databaseName,
          error instanceof Error ? error.stack : String(error),
        );
      },
      onPoolClosed: (databaseName) => {
        for (const [slug, entry] of [...this.preparedKysely]) {
          if (entry.databaseName === databaseName) this.preparedKysely.delete(slug);
        }
      },
    });
    this.kyselyPools.startIdleSweeper(Math.min(30_000, Math.max(1_000, Math.floor(idleTimeoutMs / 2))));
    this.routedKysely = this.createRoutedHandle(() => this.currentKysely());
  }




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

  isSpacePrepared(slug: string): boolean {
    return this.preparedKysely.has(slug);
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

  currentContextDatabaseName(): string | undefined {
    const scope = tenantAls.getStore();
    const slug = scope?.spaceSlug;
    if (!slug) return undefined;
    const prepared = this.preparedKysely.get(slug);
    if ((this.dedicatedSlugs.has(slug) && (!scope?.spaceId || !prepared
      || prepared.spaceId !== scope.spaceId || prepared.db !== scope.spaceHandle))
      || (!this.dedicatedSlugs.has(slug) && (!!scope?.spaceId || !!scope?.spaceHandle))) {
      throw new SpaceRoutingError('space_routing.prepared_identity_mismatch', `Space ${slug} changed identity while using its cache`);
    }
    if (!this.dedicatedSlugs.has(slug)) return undefined;
    return this.dedicatedDatabaseNames.get(slug);
  }

  async getKyselyForSpace(slug: string): Promise<CentreDb> {
    const target = await this.resolver.resolve(slug);
    const db = await this.prepareKyselySide(slug, target);
    this.recordSpaceMode(slug, target);
    return db;
  }

  private async prepareKyselySide(
    slug: string,
    target: ResolvedSpaceConnection,
  ): Promise<CentreDb> {
    const connectionString = target.connectionString;
    if (!connectionString) {
      throw new SpaceRoutingError(
        'space_routing.secret_missing',
        `Resolved dedicated target for space ${slug} has no connection string`,
      );
    }
    const handle = await this.kyselyPools.getHandleForIdentity(target.databaseName, connectionString, (databaseName) => {
      const connection = databaseConnectionFromEnv(connectionString, this.ssl);
      const pool = new TenantAwarePool(
        typeof connection === 'string'
          ? { connectionString: connection, max: this.poolMax }
          : { ...connection, max: this.poolMax },
      );
      return { databaseName, pool, db: createCentreKysely(pool) };
    });
    this.preparedKysely.set(slug, { db: handle.db, databaseName: target.databaseName, spaceId: target.spaceId });
    return handle.db;
  }

  private recordSpaceMode(slug: string, target: ResolvedSpaceConnection): void {
    this.dedicatedSlugs.add(slug);
    this.dedicatedDatabaseNames.set(slug, target.databaseName);
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
      if (this.dedicatedSlugs.has(slug)) {
        throw new SpaceRoutingError(
          'space_routing.prepared_revoked',
          `Space ${slug} was prepared with a dedicated store but that preparation is no longer active; prepare the space again before routing queries to it`,
        );
      }
      throw new SpaceRoutingError(
        'space_routing.not_prepared',
        `Space ${slug} has no prepared database handle; prepare the space before routing queries`,
      );
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
  }
}
