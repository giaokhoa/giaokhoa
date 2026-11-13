import { Injectable } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { CurriculumRepository } from '@giaokhoa/db/repositories/curriculum';
import { ContextsService } from '../access/contexts.service';
import {
  buildProgramDumpSql, loadProgramDumpSql, restoreProgramDumpSql, PROGRAM_DUMP_VERSION,
} from './program-dump';

@Injectable()
export class ProgramDumpService {
  constructor(
    private readonly repo: CurriculumRepository,
    private readonly contexts: ContextsService,
  ) {}

  async restoreIfEmpty(): Promise<{ restored: boolean; version: string }> {
    const existing = await this.repo.countProgramRecords();
    if (existing > 0) return { restored: false, version: PROGRAM_DUMP_VERSION };
    const system = await this.contexts.ensureSystemContext();
    await restoreProgramDumpSql(this.repo.dbHandle, loadProgramDumpSql(), { anchorContextId: system.id });
    return { restored: true, version: PROGRAM_DUMP_VERSION };
  }

  async buildDumpSql(opts?: { datasetKey?: string }): Promise<string> {
    return buildProgramDumpSql(this.repo.dbHandle, opts);
  }

  async restoreDumpSql(dumpSql: string): Promise<void> {
    const system = await this.contexts.ensureSystemContext();
    await restoreProgramDumpSql(this.repo.dbHandle, dumpSql, { anchorContextId: system.id });
  }

  async exportDumpToFile(filePath: string): Promise<{ version: string }> {
    const dumpSql = await buildProgramDumpSql(this.repo.dbHandle);
    writeFileSync(filePath, dumpSql, 'utf8');
    return { version: PROGRAM_DUMP_VERSION };
  }
}
