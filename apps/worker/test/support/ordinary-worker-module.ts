import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { TenantAwarePool } from '../../src/db/tenant-pool';
import { SpaceDatabaseService } from '../../src/db/routing/space-database.service';
import { WorkerModule } from '../../src/worker.module';
import { adminDatabaseUrl, ensureOrdinaryRole, ordinaryRoleUrl } from './ordinary-role';

export interface OrdinaryWorkerModuleHarness {
  context: INestApplicationContext;
  adminDb: CentreDb;
  ordinaryDb: CentreDb;
  spaceDb: SpaceDatabaseService;
  close: () => Promise<void>;
}

export async function bootWorkerModuleAsOrdinaryRole(): Promise<OrdinaryWorkerModuleHarness> {
  const adminUrl = adminDatabaseUrl();
  await ensureOrdinaryRole(adminUrl);

  const adminPool = new Pool({ connectionString: adminUrl });
  const adminDb = createCentreKysely(adminPool);

  const ordinaryPool = new TenantAwarePool({ connectionString: ordinaryRoleUrl(adminUrl) });
  const ordinaryDb = createCentreKysely(ordinaryPool);

  const context = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  await context.init();

  const spaceDb = context.get(SpaceDatabaseService);
  spaceDb.bindSharedKysely(createCentreKysely(ordinaryPool));

  return {
    context,
    adminDb,
    ordinaryDb,
    spaceDb,
    close: async () => {
      await context.close();
      await ordinaryPool.end();
      await adminPool.end();
    },
  };
}
