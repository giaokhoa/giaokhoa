import { basename, join } from 'node:path';
import { Client, Pool } from 'pg';
import { createCentreKysely } from '@giaokhoa/db';
import { applyStoreMigrations } from '@giaokhoa/db/migrate';
import type { SchemaMigrationStep } from '@giaokhoa/db/control-plane';
import {
  dumpDatabaseToFile,
  listMigrationFolders,
  newFleetRunId,
  orderSpacesIntoWaves,
  parsePositiveInt,
  readDatabaseAppliedMigrations,
  readDatabaseSchemaVersion,
  resolveCentreMigrationsDir,
  resolveDumpConnectionUrl,
  resolveSpaceConnectionUrl,
  type FleetSpace,
} from './fleet-common';
import { FleetRegistryWriter } from './fleet-registry-writer';

export type FleetMigrationOptions = {
  env?: NodeJS.ProcessEnv;
  migrationsDir?: string;
  backupDir?: string;
  waveSize?: number;
  log?: (message: string) => void;
};

export type FleetMigrationSpaceOutcome = {
  slug: string;
  outcome: 'migrated' | 'failed' | 'reconciled' | 'skipped';
  detail?: string;
};

export type FleetMigrationSummary = {
  runId: string;
  targetVersion: string;
  outcomes: FleetMigrationSpaceOutcome[];
  failedCount: number;
};

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

async function migrateSpace(
  space: FleetSpace,
  context: {
    env: NodeJS.ProcessEnv;
    migrationsDir: string;
    migrationFolders: string[];
    backupDir: string;
    runId: string;
    targetVersion: string;
    writer: FleetRegistryWriter;
    log: (message: string) => void;
  },
): Promise<FleetMigrationSpaceOutcome> {
  const { env, writer, log } = context;
  const steps: SchemaMigrationStep[] = [];
  let fromVersion: string | null = null;
  const fail = async (detail: string): Promise<FleetMigrationSpaceOutcome> => {
    await writer.recordMigrationOutcome(space.id, {
      runId: context.runId,
      fromVersion,
      toVersion: context.targetVersion,
      status: 'failed',
      steps,
    });
    log(`[${space.slug}] FAILED: ${detail}`);
    return { slug: space.slug, outcome: 'failed', detail };
  };

  try {
    const url = resolveSpaceConnectionUrl(space, env);

    const probe = new Client({ connectionString: url });
    let applied: string[];
    try {
      await probe.connect();
      applied = await readDatabaseAppliedMigrations(probe);
      fromVersion = await readDatabaseSchemaVersion(probe);
    } finally {
      await probe.end().catch(() => undefined);
    }
    const missing = context.migrationFolders.filter((folder) => !applied.includes(folder));

    if (missing.length === 0) {
      if (space.registryVersion !== context.targetVersion) {
        await writer.syncVersion(space.id, context.targetVersion);
        log(`[${space.slug}] already at ${context.targetVersion} in its database; registry reconciled`);
        return { slug: space.slug, outcome: 'reconciled' };
      }
      log(`[${space.slug}] already at ${context.targetVersion}; skipped`);
      return { slug: space.slug, outcome: 'skipped' };
    }

    try {
      const stored = await dumpDatabaseToFile({
        url: resolveDumpConnectionUrl(space, env),
        dir: join(context.backupDir, space.slug),
        kind: 'pre-migration',
        runId: context.runId,
        at: new Date(),
        encryptionKey: env.FLEET_BACKUP_ENCRYPTION_KEY || undefined,
        env,
      });
      steps.push({ name: 'pre-migration-backup', status: 'success', detail: basename(stored.path) });
    } catch (error) {
      const detail = errorDetail(error);
      steps.push({ name: 'pre-migration-backup', status: 'failed', detail });
      return fail(`pre-migration backup failed: ${detail}`);
    }

    const pool = new Pool({ connectionString: url });
    try {
      const db = createCentreKysely(pool);
      await applyStoreMigrations(db, 'centre', context.migrationsDir, { allowUnorderedMigrations: true });
      steps.push({ name: 'apply-migrations', status: 'success' });
    } catch (error) {
      const detail = errorDetail(error);
      steps.push({ name: 'apply-migrations', status: 'failed', detail });
      return fail(`migration failed: ${detail}`);
    } finally {
      await pool.end();
    }

    const verify = new Client({ connectionString: url });
    let stillMissing: string[];
    let reached: string | null;
    try {
      await verify.connect();
      const appliedAfter = await readDatabaseAppliedMigrations(verify);
      stillMissing = context.migrationFolders.filter((folder) => !appliedAfter.includes(folder));
      reached = await readDatabaseSchemaVersion(verify);
    } finally {
      await verify.end().catch(() => undefined);
    }
    if (stillMissing.length > 0 || reached !== context.targetVersion) {
      const detail =
        stillMissing.length > 0
          ? `migration(s) still missing after apply: ${stillMissing.join(', ')}`
          : `expected version ${context.targetVersion} after migration, database reports ${reached ?? 'none'}`;
      steps.push({ name: 'verify-version', status: 'failed', detail });
      return fail(detail);
    }
    steps.push({ name: 'verify-version', status: 'success' });
    await writer.recordMigrationOutcome(space.id, {
      runId: context.runId,
      fromVersion,
      toVersion: context.targetVersion,
      status: 'success',
      steps,
    });
    log(`[${space.slug}] migrated ${fromVersion ?? 'none'} -> ${context.targetVersion}`);
    return { slug: space.slug, outcome: 'migrated' };
  } catch (error) {
    return fail(errorDetail(error));
  }
}

export async function runFleetMigration(options: FleetMigrationOptions = {}): Promise<FleetMigrationSummary> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const backupDir = options.backupDir ?? env.FLEET_BACKUP_DIR;
  if (!backupDir) throw new Error('FLEET_BACKUP_DIR is required (pre-migration backups need a destination)');
  const migrationsDir =
    options.migrationsDir ?? env.FLEET_MIGRATIONS_DIR ?? resolveCentreMigrationsDir();
  const folders = listMigrationFolders(migrationsDir);
  const targetVersion = folders[folders.length - 1];
  if (!targetVersion) throw new Error(`no migration folders found under ${migrationsDir}`);
  const waveSize = options.waveSize ?? parsePositiveInt(env.FLEET_WAVE_SIZE, 2);
  const runId = newFleetRunId(new Date());

  const writer = new FleetRegistryWriter(env);
  try {
    const spaces = await writer.listFleetSpaces();
    const waves = orderSpacesIntoWaves(spaces, waveSize);
    log(`fleet migration run ${runId}: target ${targetVersion}, ${waves.length} wave(s)`);
    const outcomes: FleetMigrationSpaceOutcome[] = [];
    for (const [index, wave] of waves.entries()) {
      let waveFailed = false;
      for (const space of wave) {
        const outcome = await migrateSpace(space, {
          env,
          migrationsDir,
          migrationFolders: folders,
          backupDir,
          runId,
          targetVersion,
          writer,
          log,
        });
        outcomes.push(outcome);
        if (outcome.outcome === 'failed') waveFailed = true;
      }
      if (waveFailed) {
        log(`wave ${index + 1} had failures; later waves are not started`);
        break;
      }
    }
    const failedCount = outcomes.filter((outcome) => outcome.outcome === 'failed').length;
    log(`fleet migration run ${runId} finished: ${outcomes.length} space(s) processed, ${failedCount} failed`);
    return { runId, targetVersion, outcomes, failedCount };
  } finally {
    await writer.close();
  }
}

if (require.main === module) {
  runFleetMigration()
    .then((summary) => {
      process.exitCode = summary.failedCount > 0 ? 1 : 0;
    })
    .catch((error: unknown) => {
      console.error('fleet-migration-runner failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
