import 'reflect-metadata';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import {
  OutboxWriterService,
  PaymentsRepository,
  PlanEntitlementsService,
  SepayMatchingService,
} from '@giaokhoa/payments';
import type { ConfigService } from '@nestjs/config';
import { CohortSyncService } from '../../../worker/src/cohort-sync.service';
import { SepayMatchingScheduler } from '../../../worker/src/sepay-matching.scheduler';
import { SpaceDatabaseService } from '../../../worker/src/db/routing/space-database.service';
import { TenantAwarePool } from '../../../worker/src/db/tenant-pool';
import { WorkerEnrolOutboxService } from '../../../worker/src/worker-enrol-outbox.service';
import { WorkerPaidClassEnrolActivationService } from '../../../worker/src/worker-paid-class-enrol-activation.service';
import { WorkerPaidEnrolActivationService } from '../../../worker/src/worker-paid-enrol-activation.service';
import { WorkerPaymentSettlementService } from '../../../worker/src/worker-payment-settlement.service';
import { WorkerPaymentSpaceScope } from '../../../worker/src/worker-payment-space-scope.service';

let scheduler: SepayMatchingScheduler | null = null;
let pool: TenantAwarePool | null = null;
let sharedKysely: CentreDb | null = null;
let spaceDatabase: SpaceDatabaseService | null = null;
let cohortSync: CohortSyncService | null = null;
let cohortWatermark = '0';

function getSharedKysely(): CentreDb {
  if (!sharedKysely) {
    pool ??= new TenantAwarePool({ connectionString: process.env.DATABASE_URL });
    sharedKysely = createCentreKysely(pool);
  }
  return sharedKysely;
}

function getSpaceDatabase(): SpaceDatabaseService {
  if (!spaceDatabase) {
    spaceDatabase = new SpaceDatabaseService({ get: () => undefined } as unknown as ConfigService);
    spaceDatabase.bindSharedKysely(getSharedKysely());
  }
  return spaceDatabase;
}

function getScheduler(): SepayMatchingScheduler {
  if (!scheduler) {
    const repo = new PaymentsRepository(getSharedKysely());
    const writer = new OutboxWriterService(getSharedKysely());
    const plans = new PlanEntitlementsService(repo);
    const spaceDatabase = getSpaceDatabase();
    const enrolOutbox = new WorkerEnrolOutboxService(spaceDatabase);
    const spaceScope = new WorkerPaymentSpaceScope(spaceDatabase);
    const matching = new SepayMatchingService(
      repo,
      writer,
      new WorkerPaidEnrolActivationService(enrolOutbox, spaceScope),
      new WorkerPaidClassEnrolActivationService(enrolOutbox, spaceScope),
      plans,
      new WorkerPaymentSettlementService(repo, enrolOutbox, spaceScope),
    );
    scheduler = new SepayMatchingScheduler(matching);
  }
  return scheduler;
}

export async function driveSepaySweep(): Promise<void> {
  await getScheduler().sweepTick();
}

const COHORT_SYNC_TYPES = ['cohort_member_added', 'cohort_member_removed'] as const;

export async function driveCohortSync(): Promise<void> {
  if (!cohortSync) cohortSync = new CohortSyncService(getSpaceDatabase());
  const rows = await getSharedKysely()
    .selectFrom('outbox_events')
    .select(['seq', 'type', 'payload'])
    .where('seq', '>', cohortWatermark)
    .where('type', 'in', [...COHORT_SYNC_TYPES])
    .orderBy('seq', 'asc')
    .limit(200)
    .execute();
  for (const row of rows) {
    try {
      const payload = row.payload as Record<string, unknown>;
      const cohortId = typeof payload.cohortId === 'string' ? payload.cohortId : null;
      const userId = typeof payload.userId === 'string' ? payload.userId : null;
      if (cohortId && userId) {
        if (row.type === 'cohort_member_added') await cohortSync.materializeMemberAdded({ cohortId, userId });
        else if (row.type === 'cohort_member_removed') await cohortSync.materializeMemberRemoved({ cohortId, userId });
      }
    } catch (error) {
      console.warn(`Nhịp đồng bộ cohort bỏ qua seq=${row.seq} (${row.type}): ${(error as Error).message}`);
    }
    cohortWatermark = row.seq;
  }
}

export async function closeSepaySweepDriver(): Promise<void> {
  scheduler = null;
  cohortSync = null;
  cohortWatermark = '0';
  sharedKysely = null;
  spaceDatabase = null;
  if (pool) {
    const closing = pool;
    pool = null;
    await closing.end();
  }
}
