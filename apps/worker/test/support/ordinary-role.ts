import { Client } from 'pg';

export const ORDINARY_ROLE = 'giaokhoa_worker_ordinary';

export const ORDINARY_ROLE_PASSWORD = 'giaokhoa-worker-ordinary-test-password';

const ORDINARY_ROLE_SETUP_LOCK = 294001;

export function adminDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL chưa được đặt cho suite worker');
  return url;
}

export async function ensureOrdinaryRole(adminUrl: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`SELECT pg_advisory_lock(${ORDINARY_ROLE_SETUP_LOCK})`);
    try {
      await admin.query(
        `DO $$ BEGIN CREATE ROLE ${ORDINARY_ROLE} LOGIN PASSWORD '${ORDINARY_ROLE_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`,
      );
      await admin.query(
        `ALTER ROLE ${ORDINARY_ROLE} WITH LOGIN PASSWORD '${ORDINARY_ROLE_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${ORDINARY_ROLE}`);
      await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${ORDINARY_ROLE}`);
      await admin.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${ORDINARY_ROLE}`);
    } finally {
      await admin.query(`SELECT pg_advisory_unlock(${ORDINARY_ROLE_SETUP_LOCK})`);
    }
  } finally {
    await admin.end();
  }
}

export function ordinaryRoleUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.username = ORDINARY_ROLE;
  url.password = ORDINARY_ROLE_PASSWORD;
  return url.toString();
}
