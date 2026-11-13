import { Client } from 'pg';
import {
  buildEnsureDatabaseStatements,
  buildEnsureRoleStatements,
  buildRestrictBusinessConnectStatements,
  buildRestrictConnectStatements,
  parseBusinessTarget,
  parseControlPlaneTarget,
  quoteIdentifier,
} from './control-plane-provision';

async function main(): Promise<void> {
  const controlPlaneUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  if (!controlPlaneUrl) {
    console.log('control-plane-setup: CONTROL_PLANE_DATABASE_URL is not set — skipping provisioning.');
    return;
  }
  const businessUrl = process.env.DATABASE_URL;
  if (!businessUrl) throw new Error('DATABASE_URL is required to derive the business database target');
  const adminSourceUrl = process.env.DATABASE_ADMIN_URL ?? businessUrl;

  const target = parseControlPlaneTarget(controlPlaneUrl);
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
    const businessTarget = parseBusinessTarget(businessUrl);
    const businessResult = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [businessTarget.database]);
    if ((businessResult.rowCount ?? 0) === 0) {
      throw new Error(`business database ${quoteIdentifier(businessTarget.database)} does not exist on this cluster`);
    }
    for (const statement of buildRestrictBusinessConnectStatements(businessTarget)) {
      await client.query(statement);
    }
    console.log(
      `control-plane-setup: database ${quoteIdentifier(target.database)} and role ${quoteIdentifier(target.role)} are ready.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('control-plane-setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
