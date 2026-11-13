import { Client } from 'pg';
import { quoteIdentifier } from '../control-plane/control-plane-provision';
import {
  buildEnsureRoleStatements,
  buildOwnershipTransferQuery,
  buildRoleConnectStatements,
  buildRuntimeGrantStatements,
  buildTransferDatabaseOwnerStatement,
  parseRoleEndpoint,
  type RoleEndpoint,
} from './runtime-roles';

function retargetAdminUrl(adminUrl: string, database: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function databaseOwner(client: Client, database: string): Promise<string | undefined> {
  const result = await client.query<{ owner: string }>(
    `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`,
    [database],
  );
  return result.rows[0]?.owner;
}

async function roleExists(client: Client, role: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  return (result.rowCount ?? 0) > 0;
}

export async function runRuntimeRolesSetup(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ skipped: boolean }> {
  const migrationUrl = env.MIGRATION_DATABASE_URL;
  const runtimeUrl = env.RUNTIME_DATABASE_URL;
  if (!migrationUrl || !runtimeUrl) {
    console.log('runtime-roles-setup: MIGRATION_DATABASE_URL/RUNTIME_DATABASE_URL are not set — skipping role provisioning.');
    return { skipped: true };
  }
  const adminUrl = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL (or DATABASE_URL) is required to reach the cluster admin connection');

  const migrator = parseRoleEndpoint(migrationUrl, 'MIGRATION_DATABASE_URL');
  const runtime = parseRoleEndpoint(runtimeUrl, 'RUNTIME_DATABASE_URL');
  if (migrator.database !== runtime.database) {
    throw new Error(
      `MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL must name the same database (got ${migrator.database} vs ${runtime.database})`,
    );
  }
  if (migrator.role === runtime.role) {
    throw new Error('MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL must carry two different roles');
  }
  const adminRole = decodeURIComponent(new URL(adminUrl).username);

  const admin = new Client({ connectionString: retargetAdminUrl(adminUrl, 'postgres') });
  await admin.connect();
  try {
    const owner = await databaseOwner(admin, migrator.database);
    if (owner === undefined) {
      throw new Error(`business database ${quoteIdentifier(migrator.database)} does not exist on this cluster`);
    }
    for (const endpoint of [migrator, runtime] as RoleEndpoint[]) {
      for (const statement of buildEnsureRoleStatements(endpoint, await roleExists(admin, endpoint.role))) {
        await admin.query(statement);
      }
    }
    if (owner !== migrator.role) {
      await admin.query(buildTransferDatabaseOwnerStatement(migrator));
    }
    for (const statement of buildRoleConnectStatements(migrator.database, migrator.role, runtime.role)) {
      await admin.query(statement);
    }
  } finally {
    await admin.end();
  }

  const inside = new Client({ connectionString: retargetAdminUrl(adminUrl, migrator.database) });
  await inside.connect();
  try {
    if (adminRole !== migrator.role) {
      const transfers = await inside.query<{ statement: string }>(
        buildOwnershipTransferQuery(adminRole, migrator.role),
      );
      for (const row of transfers.rows) {
        await inside.query(row.statement);
      }
    }
    for (const statement of buildRuntimeGrantStatements(migrator.role, runtime.role)) {
      await inside.query(statement);
    }
  } finally {
    await inside.end();
  }
  console.log(
    `runtime-roles-setup: database ${quoteIdentifier(migrator.database)} is owned by ${quoteIdentifier(migrator.role)}; runtime role ${quoteIdentifier(runtime.role)} holds data-only grants.`,
  );
  return { skipped: false };
}

if (require.main === module) {
  runRuntimeRolesSetup().catch((err: unknown) => {
    console.error('runtime-roles-setup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
