import 'reflect-metadata';
import { Queue } from 'bullmq';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { redisConnectionFromUrl } from '../../../worker/src/config/env';
import { tenantAls } from '../../../worker/src/db/tenant-als';
import { TenantAwarePool } from '../../../worker/src/db/tenant-pool';
import { EventLogWriter } from '../../../worker/src/event-log-writer.service';
import { TaskLogService } from '../../../worker/src/task-log.service';
import type { ConfigService } from '@nestjs/config';
import { SpaceDatabaseService } from '../../../worker/src/db/routing/space-database.service';
import { OutboxRelayScheduler, outboxRelayJobId } from '../../../worker/src/outbox-relay.scheduler';
import {
  OUTBOX_EVENT_QUEUE_ROUTES,
  allQueueNamesOfRoutes,
  type OutboxEventQueues,
} from '../../../worker/src/outbox-event-routes';

let relay: OutboxRelayScheduler | null = null;
let pool: TenantAwarePool | null = null;
let sharedKysely: CentreDb | null = null;
let queues: Queue[] = [];
let cleanupOutboxIds = new Set<string>();

function getSharedKysely(): CentreDb {
  if (!sharedKysely) {
    pool ??= new TenantAwarePool({ connectionString: process.env.DATABASE_URL });
    sharedKysely = createCentreKysely(pool);
  }
  return sharedKysely;
}

function getWorkerSpaceDb(): SpaceDatabaseService {
  const kysely = getSharedKysely();
  return {
    routedKysely: kysely,
    listRegisteredSpaces: async () => [],
    withSpaceKysely: async () => {
      throw new Error('cầu dẫn relay không dẫn lượt quét theo trung tâm');
    },
  } as unknown as SpaceDatabaseService;
}

function getRelay(): OutboxRelayScheduler {
  if (!relay) {
    const queueNames = allQueueNamesOfRoutes(OUTBOX_EVENT_QUEUE_ROUTES);
    const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? '');
    queues = queueNames.map(
      (name) =>
        new Queue(name, {
          connection,
          prefix: 'giaokhoa',
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        }),
    );
    const queueMap: OutboxEventQueues = new Map(
      queueNames.map((name, index) => [name, queues[index]!] as const),
    );
    const unconfigured = {
      get: (_key: string, fallback?: unknown) => fallback,
    } as unknown as ConfigService;
    const spaceDb = getWorkerSpaceDb();
    relay = new OutboxRelayScheduler(
      new EventLogWriter(spaceDb),
      new TaskLogService(spaceDb),
      OUTBOX_EVENT_QUEUE_ROUTES,
      queueMap,
      spaceDb,
      unconfigured,
    );
  }
  return relay;
}

async function readOutboxIdsByStampState(
  db: CentreDb,
  stamped: boolean,
): Promise<Set<string>> {
  const rows = await tenantAls.run({ platform: true }, async () => {
    return await db
      .selectFrom('outbox_events')
      .select('id')
      .where('published_at', stamped ? 'is not' : 'is', null)
      .execute();
  });
  return new Set(rows.map((row) => row.id));
}

export async function flushWorkerRelay(): Promise<number> {
  const target = getRelay();
  const db = getSharedKysely();
  const unpublishedBefore = await readOutboxIdsByStampState(db, false);
  const publishedBefore = await readOutboxIdsByStampState(db, true);
  let published = 0;
  try {
    for (let i = 0; i < 20; i += 1) {
      const n = await tenantAls.run({ platform: true }, () => target.publishPending(500));
      published += n;
      if (n === 0) break;
    }
    return published;
  } finally {
    for (const id of unpublishedBefore) {
      cleanupOutboxIds.add(id);
    }
    const publishedAfter = await readOutboxIdsByStampState(db, true);
    for (const id of publishedAfter) {
      if (!publishedBefore.has(id)) cleanupOutboxIds.add(id);
    }
    const unpublishedAfter = await readOutboxIdsByStampState(db, false);
    for (const id of unpublishedAfter) {
      cleanupOutboxIds.add(id);
    }
  }
}

export async function closeWorkerRelayDriver(): Promise<void> {
  const toClose = queues;
  const jobIds = [...cleanupOutboxIds];
  queues = [];
  relay = null;
  cleanupOutboxIds = new Set();
  const removalErrors: unknown[] = [];
  await Promise.all(
    toClose.map(async (queue) => {
      for (const jobId of jobIds) {
        try {
          await queue.remove(outboxRelayJobId(null, jobId));
        } catch (error) {
          removalErrors.push(error);
        }
      }
    }),
  );
  await Promise.all(toClose.map((queue) => queue.close()));
  if (pool) {
    const closing = pool;
    pool = null;
    sharedKysely = null;
    await closing.end();
  }
  if (removalErrors.length > 0) {
    throw new Error(
      `Worker relay driver failed to remove ${removalErrors.length} job(s) it created`,
    );
  }
}
