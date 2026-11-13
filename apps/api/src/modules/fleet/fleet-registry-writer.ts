import type { ConfigService } from '@nestjs/config';
import type { SchemaMigrationStep } from '@giaokhoa/db/control-plane';
import type { SpaceRegistryRow } from '@giaokhoa/db/repositories/control-plane';
import type { FleetSpace } from './fleet-common';
import { ControlPlaneRepository } from '@giaokhoa/db/repositories/control-plane';
import { ControlPlaneConnection } from '../../db/control-plane-connection.service';

export type MigrationRunOutcome = {
  runId: string;
  fromVersion: string | null;
  toVersion: string | null;
  status: 'success' | 'failed';
  steps: SchemaMigrationStep[];
};

export class FleetRegistryWriter {
  private readonly connection: ControlPlaneConnection;
  private readonly repo: ControlPlaneRepository;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const stub = {
      get: (key: string) => (key === 'DATABASE_SSL' ? env[key] === 'true' : env[key]),
    } as unknown as ConfigService;
    this.connection = new ControlPlaneConnection(stub);
    if (!this.connection.isConfigured) {
      throw new Error('CONTROL_PLANE_DATABASE_URL is required for fleet operations tooling');
    }
    this.repo = new ControlPlaneRepository(this.connection.kysely);
  }

  async listFleetSpaces(): Promise<FleetSpace[]> {
    const spaces = await this.repo.listSpaces();
    const fleet: FleetSpace[] = [];
    for (const space of spaces) {
      const registry = await this.repo.findSchemaRegistry(space.id);
      fleet.push({
        id: space.id,
        slug: space.slug,
        kind: space.kind === 'platform' ? 'platform' : 'center',
        storageMode: space.storageMode,
        status: space.status,
        databaseName: space.databaseName,
        secretRef: space.secretRef,
        registryVersion: registry?.currentVersion ?? space.schemaVersion,
        lastBackupAt: registry?.lastBackupAt ?? null,
        lastRestoreAt: registry?.lastRestoreAt ?? null,
      });
    }
    return fleet;
  }

  async findSpaceBySlug(slug: string): Promise<SpaceRegistryRow | undefined> {
    return this.repo.findSpaceBySlug(slug);
  }

  async findSpaceByDatabaseName(databaseName: string): Promise<SpaceRegistryRow | undefined> {
    return this.repo.findSpaceByDatabaseName(databaseName);
  }

  async createSpaceRegistration(
    actorId: string,
    values: {
      slug: string;
      name: string;
      kind: 'center' | 'platform';
      databaseName: string;
      connectionRoleRef: string;
      secretRef: string;
      plan: string | null;
    },
  ): Promise<SpaceRegistryRow | undefined> {
    return this.repo.transaction(async (tx) => {
      const row = await this.repo.insertSpaceIfAbsent(
        {
          slug: values.slug,
          name: values.name,
          kind: values.kind,
          status: 'provisioning',
          databaseName: values.databaseName,
          storageMode: 'dedicated',
          connectionRoleRef: values.connectionRoleRef,
          secretRef: values.secretRef,
          schemaVersion: null,
          plan: values.plan,
        },
        tx,
      );
      if (!row) return undefined;
      await this.repo.insertHistory({ spaceId: row.id, actorId, action: 'create', before: null, after: snapshotOf(row) }, tx);
      return row;
    });
  }

  async changeSpaceStatus(
    spaceId: string,
    status: 'provisioning' | 'active' | 'suspended' | 'closed',
    actorId: string,
  ): Promise<SpaceRegistryRow> {
    return this.repo.transaction(async (tx) => {
      const existing = await this.repo.findSpaceByIdForUpdate(spaceId, tx);
      if (!existing) throw new Error(`Space registration ${spaceId} not found`);
      if (existing.status === status) return existing;
      const row = await this.repo.updateSpace(spaceId, { status }, tx);
      await this.repo.insertHistory(
        { spaceId, actorId, action: 'status_change', before: snapshotOf(existing), after: snapshotOf(row) },
        tx,
      );
      return row;
    });
  }

  async recordMigrationOutcome(spaceId: string, outcome: MigrationRunOutcome): Promise<void> {
    await this.repo.transaction(async (tx) => {
      await this.repo.findSpaceByIdForUpdate(spaceId, tx);
      await this.repo.insertMigrationRun(
        {
          spaceId,
          runId: outcome.runId,
          fromVersion: outcome.fromVersion,
          toVersion: outcome.toVersion,
          status: outcome.status,
          steps: outcome.steps,
          finishedAt: new Date(),
        },
        tx,
      );
      if (outcome.status === 'success' && outcome.toVersion) {
        const existing = await this.repo.findSchemaRegistry(spaceId, tx);
        await this.repo.upsertSchemaRegistry(
          {
            spaceId,
            currentVersion: outcome.toVersion,
            lastBackupStatus: existing?.lastBackupStatus ?? null,
            lastBackupAt: existing?.lastBackupAt ?? null,
            lastRestoreStatus: existing?.lastRestoreStatus ?? null,
            lastRestoreAt: existing?.lastRestoreAt ?? null,
          },
          tx,
        );
        await this.repo.updateSpace(spaceId, { schemaVersion: outcome.toVersion }, tx);
      }
    });
  }

  async syncVersion(spaceId: string, version: string | null): Promise<void> {
    await this.repo.transaction(async (tx) => {
      await this.repo.findSpaceByIdForUpdate(spaceId, tx);
      const existing = await this.repo.findSchemaRegistry(spaceId, tx);
      await this.repo.upsertSchemaRegistry(
        {
          spaceId,
          currentVersion: version,
          lastBackupStatus: existing?.lastBackupStatus ?? null,
          lastBackupAt: existing?.lastBackupAt ?? null,
          lastRestoreStatus: existing?.lastRestoreStatus ?? null,
          lastRestoreAt: existing?.lastRestoreAt ?? null,
        },
        tx,
      );
      await this.repo.updateSpace(spaceId, { schemaVersion: version }, tx);
    });
  }

  async recordBackupOutcome(spaceId: string, status: 'success' | 'failed', at: Date): Promise<void> {
    if (status === 'success') {
      await this.mergeRegistry(spaceId, { lastBackupStatus: status, lastBackupAt: at });
      return;
    }
    await this.mergeRegistry(spaceId, { lastBackupStatus: status });
  }

  async recordRestoreOutcome(spaceId: string, status: 'success' | 'failed', at: Date): Promise<void> {
    await this.mergeRegistry(spaceId, { lastRestoreStatus: status, lastRestoreAt: at });
  }

  private async mergeRegistry(
    spaceId: string,
    patch: Partial<{
      lastBackupStatus: string;
      lastBackupAt: Date;
      lastRestoreStatus: string;
      lastRestoreAt: Date;
    }>,
  ): Promise<void> {
    await this.repo.transaction(async (tx) => {
      const space = await this.repo.findSpaceByIdForUpdate(spaceId, tx);
      const existing = await this.repo.findSchemaRegistry(spaceId, tx);
      await this.repo.upsertSchemaRegistry(
        {
          spaceId,
          currentVersion: existing?.currentVersion ?? space?.schemaVersion ?? null,
          lastBackupStatus: patch.lastBackupStatus ?? existing?.lastBackupStatus ?? null,
          lastBackupAt: patch.lastBackupAt ?? existing?.lastBackupAt ?? null,
          lastRestoreStatus: patch.lastRestoreStatus ?? existing?.lastRestoreStatus ?? null,
          lastRestoreAt: patch.lastRestoreAt ?? existing?.lastRestoreAt ?? null,
        },
        tx,
      );
    });
  }

  async close(): Promise<void> {
    await this.connection.onModuleDestroy();
  }
}

function snapshotOf(row: SpaceRegistryRow): {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  databaseName: string;
  storageMode: string;
  connectionRoleRef: string;
  secretRef: string | null;
  schemaVersion: string | null;
  plan: string | null;
} {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    status: row.status,
    databaseName: row.databaseName,
    storageMode: row.storageMode,
    connectionRoleRef: row.connectionRoleRef,
    secretRef: row.secretRef,
    schemaVersion: row.schemaVersion,
    plan: row.plan,
  };
}
