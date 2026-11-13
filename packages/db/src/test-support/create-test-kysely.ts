import type { Pool } from 'pg';
import {
  createCentreKysely,
  createControlPlaneKysely,
  createSystemBankKysely,
  type CentreDb,
  type ControlPlaneDb,
  type SystemBankDb,
} from '../client';

export interface TestKysely {
  centre: CentreDb;
  controlPlane: ControlPlaneDb;
  systemBank: SystemBankDb;
}

export function createTestKysely(pool: Pool): TestKysely {
  return {
    centre: createCentreKysely(pool),
    controlPlane: createControlPlaneKysely(pool),
    systemBank: createSystemBankKysely(pool),
  };
}
