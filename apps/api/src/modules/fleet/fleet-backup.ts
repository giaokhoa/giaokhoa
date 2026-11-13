import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  dumpDatabaseToFile,
  isBackupOverdue,
  newFleetRunId,
  parseBackupFileName,
  parsePositiveInt,
  resolveDumpConnectionUrl,
} from './fleet-common';
import { FleetRegistryWriter } from './fleet-registry-writer';
import { archiveSidecarPaths, dumpSpaceArchive } from './fleet-space-archive';

export const CONTROL_PLANE_BACKUP_SLUG = 'control-plane';

export type FleetBackupOptions = {
  env?: NodeJS.ProcessEnv;
  backupDir?: string;
  log?: (message: string) => void;
};

export type FleetBackupTargetResult = {
  slug: string;
  status: 'success' | 'failed';
  file?: string;
  detail?: string;
};

export type FleetBackupSummary = {
  runId: string;
  results: FleetBackupTargetResult[];
  failedCount: number;
};

export type FleetBackupOverdue = { slug: string; reason: string };

function isBackupTarget(status: string): boolean {
  return status === 'active' || status === 'suspended';
}

function pruneSpaceBackupDir(dir: string, retentionDays: number, now: Date): number {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir)
    .filter((name) => parseBackupFileName(name) !== null)
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  let removed = 0;
  for (const [index, file] of files.entries()) {
    if (index === 0) continue;
    if (file.mtime.getTime() >= cutoff) continue;
    unlinkSync(join(dir, file.name));
    const archive = archiveSidecarPaths(join(dir, file.name));
    for (const sidecar of [
      join(dir, `${file.name}.sha256`),
      archive.manifest,
      archive.manifest + '.sha256',
      archive.files,
      archive.files + '.sha256',
    ]) {
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    removed += 1;
  }
  return removed;
}

export async function runFleetBackup(options: FleetBackupOptions = {}): Promise<FleetBackupSummary> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const backupDir = options.backupDir ?? env.FLEET_BACKUP_DIR;
  if (!backupDir) throw new Error('FLEET_BACKUP_DIR is required');
  const runId = newFleetRunId(new Date());
  const retentionDays = parsePositiveInt(env.FLEET_BACKUP_RETENTION_DAYS, 30);
  const encryptionKey = env.FLEET_BACKUP_ENCRYPTION_KEY || undefined;
  const writer = new FleetRegistryWriter(env);
  const results: FleetBackupTargetResult[] = [];
  try {
    const spaces = await writer.listFleetSpaces();
    for (const space of spaces) {
      if (!isBackupTarget(space.status)) continue;
      const at = new Date();
      try {
        const stored = await dumpSpaceArchive({
          space,
          url: resolveDumpConnectionUrl(space, env),
          dir: join(backupDir, space.slug),
          kind: 'scheduled',
          runId,
          at,
          encryptionKey,
          env,
        });
        await writer.recordBackupOutcome(space.id, 'success', at);
        log(`[${space.slug}] backup written: ${basename(stored.path)}`);
        results.push({
          slug: space.slug,
          status: 'success',
          file: stored.path,
        });
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        await writer.recordBackupOutcome(space.id, 'failed', at);
        log(`[${space.slug}] backup FAILED: ${detail}`);
        results.push({ slug: space.slug, status: 'failed', detail });
      }
    }
  } finally {
    await writer.close();
  }

  const cpUrl = env.CONTROL_PLANE_DATABASE_URL;
  if (cpUrl) {
    try {
      const stored = await dumpDatabaseToFile({
        url: cpUrl,
        dir: join(backupDir, CONTROL_PLANE_BACKUP_SLUG),
        kind: 'scheduled',
        runId,
        at: new Date(),
        encryptionKey,
        env,
      });
      log(`[${CONTROL_PLANE_BACKUP_SLUG}] backup written: ${basename(stored.path)}`);
      results.push({
        slug: CONTROL_PLANE_BACKUP_SLUG,
        status: 'success',
        file: stored.path,
      });
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      log(`[${CONTROL_PLANE_BACKUP_SLUG}] backup FAILED: ${detail}`);
      results.push({
        slug: CONTROL_PLANE_BACKUP_SLUG,
        status: 'failed',
        detail,
      });
    }
  }

  for (const result of results) {
    const removed = pruneSpaceBackupDir(join(backupDir, result.slug), retentionDays, new Date());
    if (removed > 0) log(`[${result.slug}] pruned ${removed} expired backup file(s)`);
  }
  const failedCount = results.filter((result) => result.status === 'failed').length;
  log(`fleet backup run ${runId} finished: ${results.length} target(s), ${failedCount} failed`);
  return { runId, results, failedCount };
}

export async function checkFleetBackups(
  options: FleetBackupOptions = {},
): Promise<{ overdue: FleetBackupOverdue[]; checked: string[] }> {
  const env = options.env ?? process.env;
  const backupDir = options.backupDir ?? env.FLEET_BACKUP_DIR;
  if (!backupDir) throw new Error('FLEET_BACKUP_DIR is required');
  const now = new Date();
  const spaceMaxAgeHours = parsePositiveInt(env.FLEET_BACKUP_MAX_AGE_HOURS, 26);
  const cpMaxAgeHours = parsePositiveInt(env.FLEET_CP_BACKUP_MAX_AGE_HOURS, 13);
  const writer = new FleetRegistryWriter(env);
  const overdue: FleetBackupOverdue[] = [];
  const checked: string[] = [];
  try {
    const spaces = await writer.listFleetSpaces();
    for (const space of spaces) {
      if (!isBackupTarget(space.status)) continue;
      checked.push(space.slug);
      if (isBackupOverdue(space.lastBackupAt, now, spaceMaxAgeHours)) {
        overdue.push({
          slug: space.slug,
          reason: space.lastBackupAt
            ? `last successful backup at ${space.lastBackupAt.toISOString()} exceeds ${spaceMaxAgeHours}h`
            : 'no successful backup recorded',
        });
      }
    }
  } finally {
    await writer.close();
  }
  checked.push(CONTROL_PLANE_BACKUP_SLUG);
  const cpDir = join(backupDir, CONTROL_PLANE_BACKUP_SLUG);
  const cpFiles = existsSync(cpDir)
    ? readdirSync(cpDir)
        .filter((name) => parseBackupFileName(name) !== null)
        .map((name) => statSync(join(cpDir, name)).mtime)
        .sort((a, b) => b.getTime() - a.getTime())
    : [];
  const newestCp = cpFiles[0];
  if (!newestCp || isBackupOverdue(newestCp, now, cpMaxAgeHours)) {
    overdue.push({
      slug: CONTROL_PLANE_BACKUP_SLUG,
      reason: newestCp
        ? `newest control plane backup at ${newestCp.toISOString()} exceeds ${cpMaxAgeHours}h`
        : 'no control plane backup file found',
    });
  }
  return { overdue, checked };
}

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  const work = checkOnly
    ? checkFleetBackups().then(({ overdue, checked }) => {
        for (const item of overdue) console.log(`OVERDUE [${item.slug}] ${item.reason}`);
        console.log(`fleet backup check: ${checked.length} target(s) checked, ${overdue.length} overdue`);
        process.exitCode = overdue.length > 0 ? 1 : 0;
      })
    : runFleetBackup().then((summary) => {
        process.exitCode = summary.failedCount > 0 ? 1 : 0;
      });
  work.catch((error: unknown) => {
    console.error('fleet-backup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
