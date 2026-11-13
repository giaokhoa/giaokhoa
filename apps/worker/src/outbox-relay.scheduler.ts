import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { CentreDb } from '@giaokhoa/db';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { SpaceRoutingError } from './db/routing/space-connection-resolver';
import { mapWithConcurrencyLimit } from './db/routing/space-sweep';
import { EventLogWriter } from './event-log-writer.service';
import { TaskLogService } from './task-log.service';
import { tenantAls } from './db/tenant-als';
import {
  OUTBOX_EVENT_QUEUES,
  OUTBOX_EVENT_ROUTES,
  queueNamesOfRoute,
  type OutboxEventJobData,
  type OutboxEventQueueRoutes,
  type OutboxEventQueues,
} from './outbox-event-routes';

interface OutboxRow {
  id: string;
  seq: number;
  aggregate: string;
  type: string;
  payload: Record<string, unknown> | null;
  occurredAt: Date;
  tenantId: string | null;
}

export function outboxRelayJobId(spaceId: string | null, outboxId: string): string {
  return `${spaceId ?? 'shared'}-${outboxId}`;
}

@Injectable()
export class OutboxRelayScheduler {
  private readonly logger = new Logger(OutboxRelayScheduler.name);

  private readonly sweepConcurrency: number;

  constructor(
    private readonly eventLog: EventLogWriter,
    private readonly taskLog: TaskLogService,
    @Inject(OUTBOX_EVENT_ROUTES) private readonly routes: OutboxEventQueueRoutes,
    @Inject(OUTBOX_EVENT_QUEUES) private readonly queues: OutboxEventQueues,
    private readonly spaceDb: SpaceDatabaseService,
    config: ConfigService,
  ) {
    this.sweepConcurrency = config.get<number>('SPACE_SWEEP_CONCURRENCY') ?? 3;
  }

  @Interval(5000)
  async relayTick(): Promise<void> {
    return tenantAls.run({ platform: true }, () => this.relayTickInContext());
  }

  private async relayTickInContext(): Promise<void> {
    const startedAt = new Date();
    try {
      const publishedShared = await this.publishPending();
      const centrePass = await this.publishPendingForCentres();
      const published = publishedShared + centrePass.published;
      if (centrePass.registryError !== undefined) {
        await this.taskLog.recordRun(
          'outbox-relay',
          startedAt,
          'failed',
          `centre outbox registry read failed: ${centrePass.registryError}`,
        );
        return;
      }
      if (centrePass.failedSlugs.length > 0) {
        await this.taskLog.recordRun(
          'outbox-relay',
          startedAt,
          'failed',
          `relayed ${published} event(s); centre outbox scan failed for: ${centrePass.failedSlugs.join(', ')}`,
        );
        return;
      }
      if (published > 0) {
        await this.taskLog.recordRun('outbox-relay', startedAt, 'success', `relayed ${published} event(s)`);
      }
    } catch (err) {
      await this.taskLog.recordRun('outbox-relay', startedAt, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async publishPending(limit = 50): Promise<number> {
    return this.publishPendingFrom(this.spaceDb.routedKysely, limit);
  }

  async publishPendingForCentres(
    limitPerCentre = 50,
  ): Promise<{ published: number; failedSlugs: string[]; registryError?: string }> {
    let spaces;
    try {
      spaces = await this.spaceDb.listRegisteredSpaces();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Không đọc được sổ đăng ký để quét outbox theo trung tâm ở nhịp này: ${message}`,
      );
      return { published: 0, failedSlugs: [], registryError: message };
    }
    const dedicated = spaces.filter((space) => space.storageMode === 'dedicated' && space.status !== 'closed');
    let published = 0;
    const failedSlugs: string[] = [];
    await mapWithConcurrencyLimit(dedicated, this.sweepConcurrency, async (space) => {
      try {
        const count = await this.spaceDb.withSpaceKysely(space.slug, (db) =>
          this.publishPendingFrom(db, limitPerCentre, { slug: space.slug, id: space.id }),
        );
        published += count;
      } catch (err) {
        failedSlugs.push(space.slug);
        this.logger.warn(
          `Quét outbox của trung tâm ${space.slug} lỗi ở nhịp này, thử lại ở nhịp sau: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    return { published, failedSlugs };
  }

  private async publishPendingFrom(
    db: CentreDb,
    limit: number,
    origin?: { slug: string; id: string },
  ): Promise<number> {
    const pendingRaw = await db
      .selectFrom('outbox_events')
      .select([
        'id', 'seq', 'aggregate', 'type', 'payload',
        'occurred_at as occurredAt', 'tenant_id as tenantId',
      ])
      .where('published_at', 'is', null)
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    const pending: OutboxRow[] = pendingRaw.map((row) => ({
      id: row.id,
      seq: Number(row.seq),
      aggregate: row.aggregate,
      type: row.type,
      payload: row.payload as Record<string, unknown> | null,
      occurredAt: row.occurredAt,
      tenantId: row.tenantId,
    }));

    const spaceSlugs = await this.resolveSpaceSlugs(db, pending);
    let published = 0;
    for (const row of pending) {
      const tenantSlug = spaceSlugs.get(row.tenantId ?? '') ?? null;
      if (row.tenantId && !tenantSlug) {
        throw new SpaceRoutingError('space_routing.outbox_tenant_missing', `Outbox ${row.id} has no owning tenant`);
      }
      if (origin && tenantSlug && tenantSlug !== origin.slug) {
        throw new SpaceRoutingError('space_routing.outbox_space_mismatch', `Outbox ${row.id} belongs to a different space`);
      }
      await this.dispatchRow(row, origin?.slug ?? null, origin?.id ?? null);
      await db
        .updateTable('outbox_events')
        .set({ published_at: new Date() })
        .where('id', '=', row.id)
        .execute();
      await this.eventLog.record({
        id: row.id, seq: row.seq, aggregate: row.aggregate, type: row.type,
        payload: row.payload as Record<string, unknown> | null, occurredAt: row.occurredAt,
        tenantId: row.tenantId,
      });
      published += 1;
    }
    if (published > 0) {
      this.logger.log(`Relayed ${published} outbox event(s)`);
    }
    return published;
  }

  private async resolveSpaceSlugs(db: CentreDb, rows: OutboxRow[]): Promise<Map<string, string>> {
    const tenantIds = [...new Set(rows.map((row) => row.tenantId).filter((id): id is string => !!id))];
    const slugs = new Map<string, string>();
    if (tenantIds.length === 0) return slugs;
    const tenantRows = await db
      .selectFrom('tenants')
      .select(['id', 'slug'])
      .where('id', 'in', tenantIds)
      .execute();
    for (const tenant of tenantRows) slugs.set(tenant.id, tenant.slug);
    return slugs;
  }

  private async dispatchRow(row: OutboxRow, spaceSlug: string | null, spaceId: string | null): Promise<void> {
    const route = this.routes[row.type];
    if (!route) return;
    const data: OutboxEventJobData = {
      outboxId: row.id,
      seq: row.seq,
      aggregate: row.aggregate,
      type: row.type,
      payload: row.payload as Record<string, unknown> | null,
      tenantId: row.tenantId,
      spaceSlug,
      spaceId,
      occurredAt: row.occurredAt.toISOString(),
    };
    for (const queueName of queueNamesOfRoute(route)) {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(
          `Outbox event type "${row.type}" is routed to queue "${queueName}" but that queue is not registered`,
        );
      }
      await queue.add(row.type, data, {
        jobId: outboxRelayJobId(spaceId, row.id),
      });
    }
  }
}
