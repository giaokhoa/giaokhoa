import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql as kyselySql } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { ContextsService } from '../access/contexts.service';
import { CENTRE_PROGRAM_PACKAGE_KEY } from './centre-provision';
import {
  loadProgramDumpSql,
  PROGRAM_DUMP_VERSION,
  restoreProgramDumpSql,
} from '../curriculum/program-dump';
import { tenantAls } from './tenant-als';

const INSTALL_RECORD_COLUMNS = [
  'package_key as packageKey',
  'version',
  'checksum',
  'installed_at as installedAt',
] as const;

export interface ProgramPackageInstallRecord {
  packageKey: string;
  version: string;
  checksum: string;
  installedAt: Date;
}

export interface SpaceProgramPackageInstallReport {
  slug: string;
  tenantId: string;
  sourceInstalls: ProgramPackageInstallRecord[];
  targetInstallBefore: ProgramPackageInstallRecord | null;
  restored: boolean;
  installRecorded: boolean;
  transferredKeys: string[];
  targetInstallAfter: ProgramPackageInstallRecord;
  outcomeCounts: {
    subjects: number;
    curricula: number;
    nodes: number;
    outcomes: number;
    programRecords: number;
  };
}

@Injectable()
export class SpaceProgramPackageService {
  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly contexts: ContextsService,
  ) {}

  async installIntoSpace(slug: string, tenantId: string): Promise<SpaceProgramPackageInstallReport> {
    const target = await this.spaceDb.resolveTarget(slug);
    if (target.mode !== 'dedicated') {
      throw new Error(
        `Cannot install the program package for centre ${slug}: its store mode is ${target.mode}, not dedicated — there is no destination store to install into`,
      );
    }

    const sourceRows = await tenantAls.run({ platform: true }, async () =>
      this.spaceDb.routedKysely
        .selectFrom('program_package_installs')
        .select(INSTALL_RECORD_COLUMNS)
        .where('tenant_id', '=', tenantId)
        .execute(),
    );
    const sourceInstalls: ProgramPackageInstallRecord[] = sourceRows.map((row) => ({
      packageKey: row.packageKey,
      version: row.version,
      checksum: row.checksum,
      installedAt: row.installedAt,
    }));

    const dumpSql = loadProgramDumpSql();
    const dumpChecksum = createHash('sha256').update(dumpSql).digest('hex');

    const result = await tenantAls.run({ platform: true }, () =>
      this.spaceDb.withSpaceKysely(slug, async () => {
        const system = await this.contexts.ensureSystemContext();
        const before = await this.spaceDb.routedKysely
          .selectFrom('program_package_installs')
          .select(INSTALL_RECORD_COLUMNS)
          .where('tenant_id', '=', tenantId)
          .where('package_key', '=', CENTRE_PROGRAM_PACKAGE_KEY)
          .executeTakeFirst();
        const targetInstallBefore: ProgramPackageInstallRecord | null = before
          ? {
              packageKey: before.packageKey,
              version: before.version,
              checksum: before.checksum,
              installedAt: before.installedAt,
            }
          : null;

        let restored = false;
        let installRecorded = false;
        if (!before) {
          const subjectCount = await this.spaceDb.routedKysely
            .selectFrom('subjects')
            .select(kyselySql<number>`count(*)::int`.as('count'))
            .executeTakeFirst();
          const programPresent = Number(subjectCount?.count ?? 0) > 0;
          if (!programPresent) {
            await restoreProgramDumpSql(
              await this.spaceDb.getKyselyForSpace(slug),
              dumpSql,
              { anchorContextId: system.id },
            );
            restored = true;
          }
          await this.spaceDb.routedKysely
            .insertInto('program_package_installs')
            .values({
              tenant_id: tenantId,
              package_key: CENTRE_PROGRAM_PACKAGE_KEY,
              version: PROGRAM_DUMP_VERSION,
              checksum: dumpChecksum,
            })
            .execute();
          installRecorded = true;
        } else if (before.version !== PROGRAM_DUMP_VERSION || before.checksum !== dumpChecksum) {
          throw new Error(
            `Centre store already has program package ${CENTRE_PROGRAM_PACKAGE_KEY} at version ${before.version} (expected ${PROGRAM_DUMP_VERSION}) — refusing to overwrite; upgrade the package instead`,
          );
        }

        const transferredKeys: string[] = [];
        for (const source of sourceInstalls) {
          if (source.packageKey === CENTRE_PROGRAM_PACKAGE_KEY) continue;
          const existing = await this.spaceDb.routedKysely
            .selectFrom('program_package_installs')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('package_key', '=', source.packageKey)
            .executeTakeFirst();
          if (!existing) {
            await this.spaceDb.routedKysely
              .insertInto('program_package_installs')
              .values({
                tenant_id: tenantId,
                package_key: source.packageKey,
                version: source.version,
                checksum: source.checksum,
                installed_at: source.installedAt,
              })
              .execute();
            transferredKeys.push(source.packageKey);
          }
        }

        const after = await this.spaceDb.routedKysely
          .selectFrom('program_package_installs')
          .select(INSTALL_RECORD_COLUMNS)
          .where('tenant_id', '=', tenantId)
          .where('package_key', '=', CENTRE_PROGRAM_PACKAGE_KEY)
          .executeTakeFirst();
        if (!after) {
          throw new Error(
            `Program package ${CENTRE_PROGRAM_PACKAGE_KEY} has no install record in the destination store after installation`,
          );
        }
        const targetInstallAfter: ProgramPackageInstallRecord = {
          packageKey: after.packageKey,
          version: after.version,
          checksum: after.checksum,
          installedAt: after.installedAt,
        };

        const countSubjects = async () => {
          const row = await this.spaceDb.routedKysely
            .selectFrom('subjects')
            .select(kyselySql<number>`count(*)::int`.as('count'))
            .executeTakeFirst();
          return Number(row?.count ?? 0);
        };
        const countCurricula = async () => {
          const row = await this.spaceDb.routedKysely
            .selectFrom('curricula')
            .select(kyselySql<number>`count(*)::int`.as('count'))
            .executeTakeFirst();
          return Number(row?.count ?? 0);
        };
        const countNodes = async () => {
          const row = await this.spaceDb.routedKysely
            .selectFrom('curriculum_nodes')
            .select(kyselySql<number>`count(*)::int`.as('count'))
            .executeTakeFirst();
          return Number(row?.count ?? 0);
        };
        const countOutcomes = async () => {
          const row = await this.spaceDb.routedKysely
            .selectFrom('learning_outcomes')
            .select(kyselySql<number>`count(*)::int`.as('count'))
            .executeTakeFirst();
          return Number(row?.count ?? 0);
        };
        const countProgramRecords = async () => {
          const row = await this.spaceDb.routedKysely
            .selectFrom('curriculum_program_records')
            .select(kyselySql<number>`count(*)::int`.as('count'))
            .executeTakeFirst();
          return Number(row?.count ?? 0);
        };
        const outcomeCounts = {
          subjects: await countSubjects(),
          curricula: await countCurricula(),
          nodes: await countNodes(),
          outcomes: await countOutcomes(),
          programRecords: await countProgramRecords(),
        };

        return {
          slug,
          tenantId,
          sourceInstalls,
          targetInstallBefore,
          restored,
          installRecorded,
          transferredKeys,
          targetInstallAfter,
          outcomeCounts,
        };
      }),
    );
    return result;
  }
}
