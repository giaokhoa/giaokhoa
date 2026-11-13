import { existsSync, mkdtempSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Client } from 'pg';
import { quoteIdentifier } from '../control-plane/control-plane-provision';
import {
  newFleetRunId,
  parseBackupFileName,
  pickRestoreCandidate,
  retargetUrl,
  runPgTool,
  type FleetSpace,
} from './fleet-common';
import { FleetRegistryWriter } from './fleet-registry-writer';
import {
  readVerifiedSpaceArchive,
  restoreArchiveFilesToLocalDir,
  removeTemporaryRestoreFiles,
  verifyRestoredFileMetadata,
} from './fleet-space-archive';

export type FleetRestoreTestOptions = {
  env?: NodeJS.ProcessEnv;
  backupDir?: string;
  spaceSlug?: string;
  log?: (message: string) => void;
};

export type FleetRestoreTestResult = {
  slug: string;
  status: 'success' | 'failed';
  tempDatabase?: string;
  tableCount?: number;
  totalRows?: number;
  detail?: string;
};

function newestBackupFile(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => parseBackupFileName(name) !== null)
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? join(dir, files[0].name) : null;
}

function countDumpTables(listOutput: Buffer): number {
  return listOutput
    .toString('utf8')
    .split('\n')
    .filter((line) => /^\d+; \d+ \d+ TABLE (?!DATA )public /.test(line.trim())).length;
}

export async function runFleetRestoreTest(options: FleetRestoreTestOptions = {}): Promise<FleetRestoreTestResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const backupDir = options.backupDir ?? env.FLEET_BACKUP_DIR;
  if (!backupDir) throw new Error('FLEET_BACKUP_DIR is required');
  const adminUrl = env.DATABASE_ADMIN_URL ?? env.MIGRATION_DATABASE_URL;
  if (!adminUrl)
    throw new Error('DATABASE_ADMIN_URL (or MIGRATION_DATABASE_URL) is required to create the temporary restore database');
  const encryptionKey = env.FLEET_BACKUP_ENCRYPTION_KEY || undefined;
  const runId = newFleetRunId(new Date());

  const writer = new FleetRegistryWriter(env);
  try {
    const spaces = await writer.listFleetSpaces();
    let space: FleetSpace | null;
    if (options.spaceSlug) {
      space = spaces.find((candidate) => candidate.slug === options.spaceSlug) ?? null;
      if (!space) throw new Error(`space ${options.spaceSlug} is not in the registry`);
    } else {
      space = pickRestoreCandidate(spaces);
      if (!space) throw new Error('no active space is available for a restore test');
    }

    const fail = async (detail: string, extra?: Partial<FleetRestoreTestResult>): Promise<FleetRestoreTestResult> => {
      await writer.recordRestoreOutcome(space.id, 'failed', new Date());
      log(`[${space.slug}] restore test FAILED: ${detail}`);
      return { slug: space.slug, status: 'failed', detail, ...extra };
    };

    const backupPath = newestBackupFile(join(backupDir, space.slug));
    if (!backupPath) return await fail('no backup file found for this space');
    log(`[${space.slug}] restore test on ${basename(backupPath)}`);

    let archive: ReturnType<typeof readVerifiedSpaceArchive>;
    try {
      archive = readVerifiedSpaceArchive(backupPath, space, encryptionKey);
    } catch (error) {
      return await fail(error instanceof Error ? error.message : String(error));
    }

    const plainPath = join(backupDir, `.restore-${runId}.dump`);
    const tempDatabase = `giaokhoa_restore_test_${space.slug.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${runId.replace(/\D/g, '').slice(0, 14)}`;
    const restoreFilesDir = mkdtempSync(join(tmpdir(), 'giaokhoa-restore-files-'));
    const admin = new Client({
      connectionString: retargetUrl(adminUrl, 'postgres'),
    });
    let adminConnected = false;
    try {
      writeFileSync(plainPath, archive.dump, { mode: 0o600 });
      await admin.connect();
      adminConnected = true;
      await admin.query(`CREATE DATABASE ${quoteIdentifier(tempDatabase)}`);
      const tempUrl = retargetUrl(adminUrl, tempDatabase);
      try {
        await runPgTool('pg_restore', tempUrl, ['--no-owner', '--no-privileges', plainPath], env);
      } catch (error) {
        return await fail(error instanceof Error ? error.message : String(error), { tempDatabase });
      }
      const listOutput = await runPgTool('pg_restore', tempUrl, ['--list', plainPath], env);
      const expectedTables = countDumpTables(listOutput);

      const check = new Client({ connectionString: tempUrl });
      await check.connect();
      try {
        const tablesResult = await check.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        );
        const tables = tablesResult.rows.map((row) => row.tablename);
        let totalRows = 0;
        for (const table of tables) {
          const counted = await check.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${quoteIdentifier('public')}.${quoteIdentifier(table)}`,
          );
          totalRows += counted.rows[0]?.n ?? 0;
        }
        if (tables.length !== expectedTables || expectedTables === 0) {
          return await fail(`restored ${tables.length} public table(s), dump catalog declares ${expectedTables}`, {
            tempDatabase,
            tableCount: tables.length,
            totalRows,
          });
        }
        await verifyRestoredFileMetadata(check, archive.manifest);
        await restoreArchiveFilesToLocalDir(archive.files, space.id, restoreFilesDir);
        if (env.FLEET_SMOKE_CHECK !== 'off') {
          if (!tables.includes('users')) {
            return await fail('restored backup has no users table; the smoke check cannot verify the seeded admin account', {
              tempDatabase,
              tableCount: tables.length,
              totalRows,
            });
          }
          const columnsResult = await check.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`,
          );
          const columns = new Set(columnsResult.rows.map((row) => row.column_name));
          const conditions = ['username = $1'];
          if (columns.has('deleted_at')) conditions.push('deleted_at IS NULL');
          if (columns.has('deleted')) conditions.push('deleted = false');
          const smokeUser = env.FLEET_SMOKE_ADMIN_USERNAME || 'admin';
          const smoke = await check.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${quoteIdentifier('public')}.${quoteIdentifier('users')} WHERE ${conditions.join(' AND ')}`,
            [smokeUser],
          );
          if ((smoke.rows[0]?.n ?? 0) < 1) {
            return await fail(`seeded admin account ${smokeUser} not found in the restored database`, {
              tempDatabase,
              tableCount: tables.length,
              totalRows,
            });
          }
        }
        await writer.recordRestoreOutcome(space.id, 'success', new Date());
        log(`[${space.slug}] restore test passed: ${tables.length} table(s), ${totalRows} row(s)`);
        return {
          slug: space.slug,
          status: 'success',
          tempDatabase,
          tableCount: tables.length,
          totalRows,
        };
      } finally {
        await check.end();
      }
    } catch (error) {
      return await fail(error instanceof Error ? error.message : String(error), { tempDatabase });
    } finally {
      if (adminConnected) {
        try {
          await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tempDatabase)}`);
        } catch {
        }
        try {
          await admin.end();
        } catch {
        }
      }
      if (existsSync(plainPath)) unlinkSync(plainPath);
      removeTemporaryRestoreFiles(restoreFilesDir);
    }
  } finally {
    await writer.close();
  }
}

if (require.main === module) {
  const spaceIndex = process.argv.indexOf('--space');
  const spaceSlug = spaceIndex >= 0 ? process.argv[spaceIndex + 1] : undefined;
  runFleetRestoreTest({ spaceSlug })
    .then((result) => {
      process.exitCode = result.status === 'success' ? 0 : 1;
    })
    .catch((error: unknown) => {
      console.error('fleet-restore-test failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
