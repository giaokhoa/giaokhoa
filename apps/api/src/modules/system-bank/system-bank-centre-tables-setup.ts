import { Client } from 'pg';
import { buildCentreSatelliteEnsureStatements } from './system-bank-centre-tables';

async function main(): Promise<void> {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required for the centre satellite tables setup');
  }
  const connectionString =
    process.env.DATABASE_SSL === 'true' && !databaseUrl.includes('sslmode=')
      ? `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}sslmode=no-verify`
      : databaseUrl;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const statement of buildCentreSatelliteEnsureStatements()) {
      await client.query(statement);
    }
    console.log('system-bank-centre-tables-setup: satellite tables are ensured in the business store.');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('system-bank-centre-tables-setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
