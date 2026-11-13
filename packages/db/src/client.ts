import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Pool } from 'pg';
import type { DB as CentreDB } from './types/centre-db';
import type { DB as ControlPlaneDB } from './types/control-plane-db';
import type { DB as SystemBankDB } from './types/system-bank-db';

export type { CentreDB, ControlPlaneDB, SystemBankDB };

export type CentreDb = Kysely<CentreDB>;

export type CentreTx = Transaction<CentreDB>;

export type ControlPlaneDb = Kysely<ControlPlaneDB>;

export type ControlPlaneTx = Transaction<ControlPlaneDB>;

export type SystemBankDb = Kysely<SystemBankDB>;

export type SystemBankTx = Transaction<SystemBankDB>;

export function createCentreKysely(pool: Pool): CentreDb {
  return new Kysely<CentreDB>({ dialect: new PostgresDialect({ pool }) });
}

export function createControlPlaneKysely(pool: Pool): ControlPlaneDb {
  return new Kysely<ControlPlaneDB>({ dialect: new PostgresDialect({ pool }) });
}

export function createSystemBankKysely(pool: Pool): SystemBankDb {
  return new Kysely<SystemBankDB>({ dialect: new PostgresDialect({ pool }) });
}
