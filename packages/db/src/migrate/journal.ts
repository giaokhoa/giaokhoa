import type { Client } from 'pg';

const MISSING_OBJECT_CODES = new Set(['42P01', '3F000']);

function isMissingObjectError(error: unknown): boolean {
  return error instanceof Object && MISSING_OBJECT_CODES.has((error as { code?: string }).code ?? '');
}

export type MigrationJournalClient = Pick<Client, 'query'>;

async function readKyselyNames(client: MigrationJournalClient): Promise<string[] | null> {
  try {
    const result = await client.query<{ name: string }>('SELECT name FROM kysely_migration');
    return result.rows.map((row) => row.name);
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

export async function getAppliedMigrations(client: MigrationJournalClient): Promise<string[]> {
  const kyselyNames = await readKyselyNames(client);
  return kyselyNames ?? [];
}

export async function getLatestAppliedMigration(client: MigrationJournalClient): Promise<string | null> {
  const kyselyNames = await readKyselyNames(client);
  if (kyselyNames === null || kyselyNames.length === 0) return null;
  return [...kyselyNames].sort().at(-1) ?? null;
}
