import { Client } from 'pg';
import {
  buildEnsureDatabaseStatements,
  buildEnsureRoleStatements,
  buildRestrictConnectStatements,
  parseSystemBankTarget,
  quoteIdentifier,
} from './system-bank-provision';

async function main(): Promise<void> {
  const systemBankUrl = process.env.SYSTEM_BANK_DATABASE_URL;
  if (!systemBankUrl) {
    console.log('system-bank-setup: SYSTEM_BANK_DATABASE_URL is not set — skipping provisioning.');
    return;
  }
  const businessUrl = process.env.DATABASE_URL;
  if (!businessUrl) throw new Error('DATABASE_URL is required to derive the cluster admin connection');
  const adminSourceUrl = process.env.DATABASE_ADMIN_URL ?? businessUrl;

  const target = parseSystemBankTarget(systemBankUrl);
  const adminUrl = new URL(adminSourceUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const roleResult = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [target.role]);
    for (const statement of buildEnsureRoleStatements(target, (roleResult.rowCount ?? 0) > 0)) {
      await client.query(statement);
    }
    const databaseResult = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.database]);
    for (const statement of buildEnsureDatabaseStatements(target, (databaseResult.rowCount ?? 0) > 0)) {
      await client.query(statement);
    }
    for (const statement of buildRestrictConnectStatements(target)) {
      await client.query(statement);
    }
    console.log(
      `system-bank-setup: database ${quoteIdentifier(target.database)} and role ${quoteIdentifier(target.role)} are ready.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('system-bank-setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
