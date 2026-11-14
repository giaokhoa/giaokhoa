import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '@giaokhoa/db/test-support';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { TenantAwarePool } from '../../src/db/tenant-pool';
import { SpaceDatabaseService } from '../../src/db/routing/space-database.service';
import { WorkerModule } from '../../src/worker.module';
import { GuardianDigestScheduler } from '../../src/guardian-digest.scheduler';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { adminDatabaseUrl, ensureOrdinaryRole, ordinaryRoleUrl, ORDINARY_ROLE } from './ordinary-role';

export interface OrdinaryWorkerModuleHarness {
  context: INestApplicationContext;
  adminDb: CentreDb;
  ordinaryDb: CentreDb;
  spaceDb: SpaceDatabaseService;
  close: () => Promise<void>;
}

export async function bootWorkerModuleAsOrdinaryRole(options: { centreSlug?: string; disableGuardianScheduler?: boolean } = {}): Promise<OrdinaryWorkerModuleHarness> {
  const adminUrl = adminDatabaseUrl();
  await ensureOrdinaryRole(adminUrl);

  const cpAdminUrl = withDatabase(adminUrl, 'postgres');
  const cpName = `giaokhoa_worker_fixture_cp_${process.pid}_${randomUUID().slice(0, 8)}`;
  const cpUrl = await buildTestDatabase({ adminUrl: cpAdminUrl, database: cpName, store: 'control-plane' });
  const secretName = 'GIAOKHOA_TEST_WORKER_CENTRE_URL';
  const previousControlPlaneUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  const previousCentreUrl = process.env[secretName];
  process.env.CONTROL_PLANE_DATABASE_URL = cpUrl;
  process.env[secretName] = ordinaryRoleUrl(adminUrl);
  const cpPool = new Pool({ connectionString: cpUrl });
  try {
    const cpDb = createControlPlaneKysely(cpPool);
    await cpDb.insertInto('space_registry').values({
      slug: options.centreSlug ?? 'worker-fixture', name: 'Trung tâm tích hợp worker', kind: 'center', status: 'active',
      database_name: new URL(adminUrl).pathname.slice(1), storage_mode: 'dedicated',
      connection_role_ref: ORDINARY_ROLE, secret_ref: `env:${secretName}`, schema_version: 'v1',
    }).execute();
  } finally {
    await cpPool.end();
  }

  const adminPool = new Pool({ connectionString: adminUrl });
  const adminDb = createCentreKysely(adminPool);

  const ordinaryPool = new TenantAwarePool({ connectionString: ordinaryRoleUrl(adminUrl) });
  const ordinaryDb = createCentreKysely(ordinaryPool);

  const builder = Test.createTestingModule({ imports: [WorkerModule] });
  if (options.disableGuardianScheduler) {
    builder.overrideProvider(GuardianDigestScheduler).useValue({ onModuleInit: () => undefined });
  }
  const context = await builder.compile();
  if (options.disableGuardianScheduler) {
    const guardianQueue = context.get<Queue>(getQueueToken('guardian-digests'));
    await guardianQueue.removeJobScheduler('guardian-digest-scheduler');
  }
  await context.init();

  const spaceDb = context.get(SpaceDatabaseService);
  spaceDb.bindSharedKysely(createCentreKysely(ordinaryPool));

  return {
    context,
    adminDb,
    ordinaryDb,
    spaceDb,
    close: async () => {
      try {
        await context.close();
        await ordinaryPool.end();
        await adminPool.end();
      } finally {
        if (previousControlPlaneUrl === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL;
        else process.env.CONTROL_PLANE_DATABASE_URL = previousControlPlaneUrl;
        if (previousCentreUrl === undefined) delete process.env[secretName];
        else process.env[secretName] = previousCentreUrl;
        await dropTestDatabase(cpAdminUrl, cpName);
      }
    },
  };
}
