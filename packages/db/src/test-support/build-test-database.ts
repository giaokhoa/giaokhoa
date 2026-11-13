import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { createCentreKysely, createControlPlaneKysely, createSystemBankKysely } from '../client';
import { applyStoreMigrations } from '../migrate/apply';
import type { Kysely } from 'kysely';

export type TestStoreKind = 'centre' | 'control-plane' | 'system-bank';

function packageRoot(): string {
  return join(__dirname, '..', '..');
}

function migrationsDirFor(store: TestStoreKind): string {
  return join(packageRoot(), 'migrations', store);
}

export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function applyCarrier(storeUrl: string, store: TestStoreKind): Promise<void> {
  const pool = new Pool({ connectionString: storeUrl });
  const run = async <DB>(db: Kysely<DB>) => {
    try {
      await applyStoreMigrations(db, store, migrationsDirFor(store));
    } finally {
      await db.destroy().catch(() => undefined);
    }
  };
  switch (store) {
    case 'centre':
      return run(createCentreKysely(pool));
    case 'control-plane':
      return run(createControlPlaneKysely(pool));
    case 'system-bank':
      return run(createSystemBankKysely(pool));
  }
}

export interface BuildTestDatabaseOptions {
  adminUrl: string;
  database: string;
  store: TestStoreKind;
}

export async function buildTestDatabase(options: BuildTestDatabaseOptions): Promise<string> {
  const admin = new Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${options.database}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${options.database}"`);
  } finally {
    await admin.end();
  }
  const storeUrl = withDatabase(options.adminUrl, options.database);
  await applyCarrier(storeUrl, options.store);
  return storeUrl;
}

export async function dropTestDatabase(adminUrl: string, database: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
