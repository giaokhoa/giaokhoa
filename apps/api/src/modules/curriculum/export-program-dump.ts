import { NestFactory } from '@nestjs/core';
import { join } from 'node:path';
import { AppModule } from '../../app.module';
import { ProgramDumpService } from './program-dump.service';
import { ProgramImportService } from './program-import.service';
import { tenantAls } from '../tenants/tenant-als';

export function resolveProgramDumpOutPath(args: string[]): string {
  const outArg = args.find((a) => !a.startsWith('--'));
  return outArg ?? join(__dirname, 'program-data-dump', 'program-dump.sql');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromDatasets = args.includes('--from-datasets');
  const outPath = resolveProgramDumpOutPath(args);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await tenantAls.run({ platform: true }, async () => {
      if (fromDatasets) {
        const importer = app.get(ProgramImportService, { strict: false });
        const results = await importer.importAllDatasetsInternal();
        for (const r of results) {
          console.log(
            `[dump] import ${r.datasetKey}: created=${r.created} updated=${r.updated} skipped=${r.skipped} ` +
            `retiredOutcomes=${r.retiredOutcomes} changes=${JSON.stringify(r.changeCounts)}`,
          );
        }
      }
      const dump = app.get(ProgramDumpService, { strict: false });
      const { version } = await dump.exportDumpToFile(outPath);
      console.log(`[dump] exported version=${version} -> ${outPath}`);
    });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[dump] export failed', err);
    process.exit(1);
  });
}
