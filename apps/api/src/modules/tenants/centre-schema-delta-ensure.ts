
import { Client } from 'pg';

import { UUIDV7_SHIM } from './centre-provision';

export type CentreDeltaStoreReport = {
  created: string[];
  alreadyPresent: string[];
};

export type CentreDeltaReport = {
  business: CentreDeltaStoreReport;
  controlPlane: CentreDeltaStoreReport | null;
};

type DeltaObject = {
  name: string;
  existsSql: string;
  createSql: string;
};

const TENANT_ISOLATION_CONDITION =
  `(current_setting('app.platform', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`;

function createPolicySql(table: string): string {
  return `DO $$ BEGIN IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '${table}' AND p.polname = 'tenant_isolation'
  ) THEN CREATE POLICY "tenant_isolation" ON "${table}" USING ${TENANT_ISOLATION_CONDITION} WITH CHECK ${TENANT_ISOLATION_CONDITION}; END IF; END $$;`;
}

function createForeignKeySql(table: string, constraint: string, definition: string): string {
  return `DO $$ BEGIN IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '${table}' AND con.conname = '${constraint}'
  ) THEN ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" ${definition}; END IF; END $$;`;
}

function tableExistsSql(table: string): string {
  return `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '${table}' AND c.relkind = 'r'`;
}

function indexExistsSql(index: string): string {
  return `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '${index}' AND c.relkind = 'i'`;
}

function policyExistsSql(table: string): string {
  return `SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '${table}' AND p.polname = 'tenant_isolation'`;
}

const BUSINESS_DELTA_OBJECTS: DeltaObject[] = [
  {
    name: 'centre_identity',
    existsSql: tableExistsSql('centre_identity'),
    createSql: `CREATE TABLE IF NOT EXISTS "centre_identity" (
      "id" uuid PRIMARY KEY DEFAULT uuidv7(),
      "tenant_id" uuid NOT NULL CONSTRAINT "centre_identity_tenant_unique" UNIQUE,
      "display_name" text NOT NULL,
      "logo_path" text,
      "brand_color" text,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )`,
  },
  {
    name: 'centre_invites',
    existsSql: tableExistsSql('centre_invites'),
    createSql: `CREATE TABLE IF NOT EXISTS "centre_invites" (
      "id" uuid PRIMARY KEY DEFAULT uuidv7(),
      "tenant_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "email" text NOT NULL,
      "token_hash" text NOT NULL UNIQUE,
      "expires_at" timestamp with time zone NOT NULL,
      "used_at" timestamp with time zone,
      "revoked_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )`,
  },
  {
    name: 'program_package_installs',
    existsSql: tableExistsSql('program_package_installs'),
    createSql: `CREATE TABLE IF NOT EXISTS "program_package_installs" (
      "id" uuid PRIMARY KEY DEFAULT uuidv7(),
      "tenant_id" uuid NOT NULL,
      "package_key" text NOT NULL,
      "version" text NOT NULL,
      "checksum" text NOT NULL,
      "installed_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "program_package_installs_tenant_key_unique" UNIQUE("tenant_id","package_key")
    )`,
  },
  {
    name: 'centre_invites_tenant_id_idx',
    existsSql: indexExistsSql('centre_invites_tenant_id_idx'),
    createSql: `CREATE INDEX IF NOT EXISTS "centre_invites_tenant_id_idx" ON "centre_invites" ("tenant_id")`,
  },
  {
    name: 'centre_invites_user_id_idx',
    existsSql: indexExistsSql('centre_invites_user_id_idx'),
    createSql: `CREATE INDEX IF NOT EXISTS "centre_invites_user_id_idx" ON "centre_invites" ("user_id")`,
  },
  {
    name: 'centre_identity_tenant_id_tenants_id_fkey',
    existsSql: `SELECT 1 FROM pg_constraint WHERE conname = 'centre_identity_tenant_id_tenants_id_fkey'`,
    createSql: createForeignKeySql('centre_identity', 'centre_identity_tenant_id_tenants_id_fkey', `FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT`),
  },
  {
    name: 'centre_invites_tenant_id_tenants_id_fkey',
    existsSql: `SELECT 1 FROM pg_constraint WHERE conname = 'centre_invites_tenant_id_tenants_id_fkey'`,
    createSql: createForeignKeySql('centre_invites', 'centre_invites_tenant_id_tenants_id_fkey', `FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT`),
  },
  {
    name: 'centre_invites_user_id_users_id_fkey',
    existsSql: `SELECT 1 FROM pg_constraint WHERE conname = 'centre_invites_user_id_users_id_fkey'`,
    createSql: createForeignKeySql('centre_invites', 'centre_invites_user_id_users_id_fkey', `FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`),
  },
  {
    name: 'program_package_installs_tenant_id_tenants_id_fkey',
    existsSql: `SELECT 1 FROM pg_constraint WHERE conname = 'program_package_installs_tenant_id_tenants_id_fkey'`,
    createSql: createForeignKeySql('program_package_installs', 'program_package_installs_tenant_id_tenants_id_fkey', `FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT`),
  },
];

const BUSINESS_RLS_TABLES = ['centre_identity', 'centre_invites', 'program_package_installs'];

const CONTROL_PLANE_DELTA_OBJECT: DeltaObject = {
  name: 'space_registry_database_name_dedicated_unique',
  existsSql: indexExistsSql('space_registry_database_name_dedicated_unique'),
  createSql: `CREATE UNIQUE INDEX IF NOT EXISTS "space_registry_database_name_dedicated_unique" ON "space_registry" ("database_name") WHERE "space_registry"."storage_mode" = 'dedicated'`,
};

async function ensureObjects(
  client: Client,
  objects: DeltaObject[],
  log: (message: string) => void,
): Promise<CentreDeltaStoreReport> {
  const report: CentreDeltaStoreReport = { created: [], alreadyPresent: [] };
  await client.query('BEGIN');
  try {
    for (const object of objects) {
      const exists = await client.query(object.existsSql);
      if ((exists.rowCount ?? 0) > 0) {
        report.alreadyPresent.push(object.name);
      } else {
        await client.query(object.createSql);
        report.created.push(object.name);
        log(`[centre-delta] created ${object.name}`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return report;
}

export async function ensureCentreSchemaDelta(options: {
  businessDatabaseUrl: string;
  controlPlaneDatabaseUrl?: string | null;
  log?: (message: string) => void;
}): Promise<CentreDeltaReport> {
  const log = options.log ?? ((message: string) => console.log(message));
  if (!options.businessDatabaseUrl) throw new Error('businessDatabaseUrl is required for centre schema delta ensure');
  const business = new Client({ connectionString: options.businessDatabaseUrl });
  await business.connect();
  try {
    const versionRow = await business.query('SHOW server_version');
    const major = Number(String(versionRow.rows[0]!.server_version).split('.')[0]);
    if (major < 18) {
      await business.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await business.query(UUIDV7_SHIM);
    }
    const businessReport = await ensureObjects(business, BUSINESS_DELTA_OBJECTS, log);
    await business.query('BEGIN');
    try {
      for (const table of BUSINESS_RLS_TABLES) {
        const policy = await business.query(policyExistsSql(table));
        if ((policy.rowCount ?? 0) > 0) {
          businessReport.alreadyPresent.push(`tenant_isolation on ${table}`);
        } else {
          await business.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
          await business.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
          await business.query(createPolicySql(table));
          businessReport.created.push(`tenant_isolation on ${table}`);
          log(`[centre-delta] created tenant_isolation on ${table}`);
        }
      }
      await business.query('COMMIT');
    } catch (error) {
      await business.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    let controlPlane: CentreDeltaStoreReport | null = null;
    if (options.controlPlaneDatabaseUrl) {
      const cp = new Client({ connectionString: options.controlPlaneDatabaseUrl });
      await cp.connect();
      try {
        controlPlane = await ensureObjects(cp, [CONTROL_PLANE_DELTA_OBJECT], log);
      } finally {
        await cp.end().catch(() => undefined);
      }
    } else {
      log('[centre-delta] CONTROL_PLANE_DATABASE_URL is not set — skipping control plane delta.');
    }
    return { business: businessReport, controlPlane };
  } finally {
    await business.end().catch(() => undefined);
  }
}

if (require.main === module) {
  (async (): Promise<void> => {
    const businessDatabaseUrl = process.env.DATABASE_URL;
    if (!businessDatabaseUrl) throw new Error('DATABASE_URL is required for centre schema delta ensure');
    const report = await ensureCentreSchemaDelta({
      businessDatabaseUrl,
      controlPlaneDatabaseUrl: process.env.CONTROL_PLANE_DATABASE_URL ?? null,
    });
    console.log(`CENTRE_SCHEMA_DELTA_ENSURE ${JSON.stringify(report)}`);
  })().catch((error: unknown) => {
    console.error(`centre-schema-delta-ensure failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
