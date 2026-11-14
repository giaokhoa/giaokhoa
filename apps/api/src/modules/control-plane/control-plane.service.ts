import { Injectable, Logger } from '@nestjs/common';
import { conflict, notFound } from '../../common/http-errors';
import type {
  ChangeSpaceStatus,
  CreateSpaceRegistration,
  RecordSpaceSchemaMigrationRun,
  SpaceRegistration,
  SpaceRegistryHistoryEntry,
  SpaceSchemaMigrationRun,
  SpaceSchemaRegistry,
  UpdateSpaceRegistration,
  UpdateSpaceSchemaRegistry,
} from '@giaokhoa/contracts';
import {
  ControlPlaneRepository,
  isDedicatedDatabaseNameConflict,
  type SpaceRegistryRow,
} from '@giaokhoa/db/repositories/control-plane';
import { emitSpaceRegistryChanged } from '../../db/routing/space-routing-events';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ControlPlaneConnection } from '../../db/control-plane-connection.service';

export const SHARED_DATABASE_SCHEMA_VERSION = '20261025163710_baseline';

export type ExistingSpaceSeed = {
  slug: string;
  name: string;
  kind: 'center' | 'platform';
  plan: string | null;
  databaseName: string;
  connectionRoleRef: string;
  secretRef: string;
};

@Injectable()
export class ControlPlaneRegistryService {
  private readonly logger = new Logger(ControlPlaneRegistryService.name);

  constructor(
    private readonly repo: ControlPlaneRepository,
    private readonly connection: ControlPlaneConnection,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
  ) {}

  get isConfigured(): boolean {
    return this.connection.isConfigured;
  }

  private async assertPlatformManager(actorId: string): Promise<void> {
    const systemId = (await this.contexts.ensureSystemContext()).id;
    await this.evaluator.requireCapability(actorId, 'tenant:manage', systemId);
  }

  private snapshot(row: SpaceRegistryRow): Omit<SpaceRegistration, 'createdAt' | 'updatedAt'> {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind as SpaceRegistration['kind'],
      status: row.status as SpaceRegistration['status'],
      databaseName: row.databaseName,
      storageMode: row.storageMode as SpaceRegistration['storageMode'],
      connectionRoleRef: row.connectionRoleRef,
      secretRef: row.secretRef,
      schemaVersion: row.schemaVersion,
      plan: row.plan,
    };
  }

  private toRegistration(row: SpaceRegistryRow): SpaceRegistration {
    return {
      ...this.snapshot(row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async createRegistration(actorId: string, dto: CreateSpaceRegistration): Promise<SpaceRegistration> {
    await this.assertPlatformManager(actorId);
    if (await this.repo.findSpaceBySlug(dto.slug)) {
      conflict(`Space slug ${dto.slug} is already registered`, 'control_plane.slug_taken');
    }
    if (await this.repo.findSpaceByDatabaseName(dto.databaseName)) {
      conflict(`Database name ${dto.databaseName} is already registered`, 'control_plane.database_name_taken');
    }
    let created: SpaceRegistryRow;
    try {
      created = await this.repo.transaction(async (tx) => {
        const row = await this.repo.insertSpaceIfAbsent(
          {
            slug: dto.slug,
            name: dto.name,
            kind: dto.kind,
            status: dto.status ?? 'provisioning',
            databaseName: dto.databaseName,
            storageMode: dto.storageMode,
            connectionRoleRef: dto.connectionRoleRef,
            secretRef: dto.secretRef ?? null,
            schemaVersion: dto.schemaVersion ?? null,
            plan: dto.plan ?? null,
          },
          tx,
        );
        if (!row) {
          conflict(`Space slug ${dto.slug} is already registered`, 'control_plane.slug_taken');
        }
        await this.repo.insertHistory(
          {
            spaceId: row.id,
            actorId,
            action: 'create',
            before: null,
            after: this.snapshot(row),
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      if (isDedicatedDatabaseNameConflict(error)) {
        conflict(`Database name ${dto.databaseName} is already registered`, 'control_plane.database_name_taken');
      }
      throw error;
    }
    emitSpaceRegistryChanged(created.slug);
    return this.toRegistration(created);
  }

  async updateRegistration(actorId: string, id: string, dto: UpdateSpaceRegistration): Promise<SpaceRegistration> {
    await this.assertPlatformManager(actorId);
    let updated: SpaceRegistryRow;
    try {
      updated = await this.repo.transaction(async (tx) => {
        const existing = await this.repo.findSpaceByIdForUpdate(id, tx);
        if (!existing) {
          notFound(`Space registration ${id} not found`, 'control_plane.space_not_found');
        }
        if (dto.databaseName !== undefined && dto.databaseName !== existing.databaseName) {
          const clash = await this.repo.findOtherSpaceByDatabaseName(dto.databaseName, id, tx);
          if (clash) {
            conflict(`Database name ${dto.databaseName} is already registered`, 'control_plane.database_name_taken');
          }
        }
        const effectiveDatabaseName = dto.databaseName ?? existing.databaseName;
        const effectiveStorageMode = dto.storageMode ?? existing.storageMode;
        if (effectiveStorageMode === 'dedicated') {
          const clash = await this.repo.findOtherSpaceByDatabaseName(effectiveDatabaseName, id, tx);
          if (clash) {
            conflict(`Database name ${effectiveDatabaseName} is already registered`, 'control_plane.database_name_taken');
          }
        }
        const row = await this.repo.updateSpace(id, { ...dto }, tx);
        await this.repo.insertHistory(
          {
            spaceId: id,
            actorId,
            action: 'update',
            before: this.snapshot(existing),
            after: this.snapshot(row),
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      if (isDedicatedDatabaseNameConflict(error)) {
        conflict(`Database name ${dto.databaseName} is already registered`, 'control_plane.database_name_taken');
      }
      throw error;
    }
    emitSpaceRegistryChanged(updated.slug);
    return this.toRegistration(updated);
  }

  async changeStatus(actorId: string, id: string, dto: ChangeSpaceStatus): Promise<SpaceRegistration> {
    await this.assertPlatformManager(actorId);
    let changedSlug: string | undefined;
    const updated = await this.repo.transaction(async (tx) => {
      const existing = await this.repo.findSpaceByIdForUpdate(id, tx);
      if (!existing) {
        notFound(`Space registration ${id} not found`, 'control_plane.space_not_found');
      }
      if (existing.status === dto.status) return existing;
      if (dto.status === 'closed') {
        conflict('Closing a centre requires the fleet lifecycle CLI', 'control_plane.close_requires_fleet_cli');
      }
      if (existing.status === 'closed') {
        conflict('A closed centre cannot be reactivated through the API', 'control_plane.closed_cannot_reactivate');
      }
      const row = await this.repo.updateSpace(id, { status: dto.status }, tx);
      await this.repo.insertHistory(
        {
          spaceId: id,
          actorId,
          action: 'status_change',
          before: this.snapshot(existing),
          after: this.snapshot(row),
        },
        tx,
      );
      changedSlug = row.slug;
      return row;
    });
    if (changedSlug) emitSpaceRegistryChanged(changedSlug);
    return this.toRegistration(updated);
  }

  async getBySlug(actorId: string, slug: string): Promise<SpaceRegistration> {
    await this.assertPlatformManager(actorId);
    const row = await this.repo.findSpaceBySlug(slug);
    if (!row) {
      notFound(`Space slug ${slug} is not registered`, 'control_plane.space_not_found');
    }
    return this.toRegistration(row);
  }

  async listHistory(actorId: string, spaceId: string): Promise<SpaceRegistryHistoryEntry[]> {
    await this.assertPlatformManager(actorId);
    if (!(await this.repo.findSpaceById(spaceId))) {
      notFound(`Space registration ${spaceId} not found`, 'control_plane.space_not_found');
    }
    const rows = await this.repo.listHistory(spaceId);
    return rows.map((row) => ({
      id: row.id,
      spaceId: row.spaceId,
      actorId: row.actorId,
      action: row.action as SpaceRegistryHistoryEntry['action'],
      before: row.before as SpaceRegistryHistoryEntry['before'],
      after: row.after as SpaceRegistryHistoryEntry['after'],
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getSchemaRegistry(actorId: string, spaceId: string): Promise<SpaceSchemaRegistry> {
    await this.assertPlatformManager(actorId);
    const space = await this.repo.findSpaceById(spaceId);
    if (!space) {
      notFound(`Space registration ${spaceId} not found`, 'control_plane.space_not_found');
    }
    const row = await this.repo.findSchemaRegistry(spaceId);
    return {
      spaceId,
      currentVersion: row?.currentVersion ?? null,
      lastBackupStatus: row?.lastBackupStatus ?? null,
      lastBackupAt: row?.lastBackupAt?.toISOString() ?? null,
      lastRestoreStatus: row?.lastRestoreStatus ?? null,
      lastRestoreAt: row?.lastRestoreAt?.toISOString() ?? null,
      updatedAt: (row?.updatedAt ?? space.updatedAt).toISOString(),
    };
  }

  async updateSchemaRegistry(
    actorId: string,
    spaceId: string,
    dto: UpdateSpaceSchemaRegistry,
  ): Promise<SpaceSchemaRegistry> {
    await this.assertPlatformManager(actorId);
    const space = await this.repo.findSpaceById(spaceId);
    if (!space) {
      notFound(`Space registration ${spaceId} not found`, 'control_plane.space_not_found');
    }
    const row = await this.repo.transaction(async (tx) => {
      await this.repo.findSpaceByIdForUpdate(spaceId, tx);
      const existing = await this.repo.findSchemaRegistry(spaceId, tx);
      const merged = {
        spaceId,
        currentVersion: dto.currentVersion !== undefined ? dto.currentVersion : (existing?.currentVersion ?? null),
        lastBackupStatus: dto.lastBackupStatus !== undefined ? dto.lastBackupStatus : (existing?.lastBackupStatus ?? null),
        lastBackupAt:
          dto.lastBackupAt !== undefined
            ? dto.lastBackupAt
              ? new Date(dto.lastBackupAt)
              : null
            : (existing?.lastBackupAt ?? null),
        lastRestoreStatus:
          dto.lastRestoreStatus !== undefined ? dto.lastRestoreStatus : (existing?.lastRestoreStatus ?? null),
        lastRestoreAt:
          dto.lastRestoreAt !== undefined
            ? dto.lastRestoreAt
              ? new Date(dto.lastRestoreAt)
              : null
            : (existing?.lastRestoreAt ?? null),
      };
      const saved = await this.repo.upsertSchemaRegistry(merged, tx);
      if (dto.currentVersion !== undefined) {
        await this.repo.updateSpace(spaceId, { schemaVersion: dto.currentVersion }, tx);
      }
      return saved;
    });
    emitSpaceRegistryChanged(space.slug);
    return {
      spaceId: row.spaceId,
      currentVersion: row.currentVersion,
      lastBackupStatus: row.lastBackupStatus,
      lastBackupAt: row.lastBackupAt?.toISOString() ?? null,
      lastRestoreStatus: row.lastRestoreStatus,
      lastRestoreAt: row.lastRestoreAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async recordMigrationRun(
    actorId: string,
    spaceId: string,
    dto: RecordSpaceSchemaMigrationRun,
  ): Promise<SpaceSchemaMigrationRun> {
    await this.assertPlatformManager(actorId);
    const space = await this.repo.findSpaceById(spaceId);
    if (!space) {
      notFound(`Space registration ${spaceId} not found`, 'control_plane.space_not_found');
    }
    let versionChanged = false;
    const run = await this.repo.transaction(async (tx) => {
      await this.repo.findSpaceByIdForUpdate(spaceId, tx);
      const saved = await this.repo.insertMigrationRun(
        {
          spaceId,
          runId: dto.runId,
          fromVersion: dto.fromVersion ?? null,
          toVersion: dto.toVersion ?? null,
          status: dto.status,
          steps: dto.steps,
          finishedAt: dto.finishedAt ? new Date(dto.finishedAt) : dto.status === 'running' ? null : new Date(),
        },
        tx,
      );
      if (dto.status === 'success' && dto.toVersion) {
        versionChanged = true;
        const existing = await this.repo.findSchemaRegistry(spaceId, tx);
        await this.repo.upsertSchemaRegistry(
          {
            spaceId,
            currentVersion: dto.toVersion,
            lastBackupStatus: existing?.lastBackupStatus ?? null,
            lastBackupAt: existing?.lastBackupAt ?? null,
            lastRestoreStatus: existing?.lastRestoreStatus ?? null,
            lastRestoreAt: existing?.lastRestoreAt ?? null,
          },
          tx,
        );
        await this.repo.updateSpace(spaceId, { schemaVersion: dto.toVersion }, tx);
      }
      return saved;
    });
    if (versionChanged) emitSpaceRegistryChanged(space.slug);
    return {
      id: run.id,
      spaceId: run.spaceId,
      runId: run.runId,
      fromVersion: run.fromVersion,
      toVersion: run.toVersion,
      status: run.status as SpaceSchemaMigrationRun['status'],
      steps: run.steps,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  async listMigrationRuns(actorId: string, spaceId: string): Promise<SpaceSchemaMigrationRun[]> {
    await this.assertPlatformManager(actorId);
    if (!(await this.repo.findSpaceById(spaceId))) {
      notFound(`Space registration ${spaceId} not found`, 'control_plane.space_not_found');
    }
    const rows = await this.repo.listMigrationRuns(spaceId);
    return rows.map((run) => ({
      id: run.id,
      spaceId: run.spaceId,
      runId: run.runId,
      fromVersion: run.fromVersion,
      toVersion: run.toVersion,
      status: run.status as SpaceSchemaMigrationRun['status'],
      steps: run.steps,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    }));
  }

  async seedExistingSpaces(spaces: ExistingSpaceSeed[]): Promise<number> {
    if (!this.isConfigured) return 0;
    let created = 0;
    for (const space of spaces) {
      const inserted = await this.repo.insertSpaceIfAbsent({
        slug: space.slug,
        name: space.name,
        kind: space.kind,
        status: 'active',
        databaseName: space.databaseName,
        storageMode: 'shared',
        connectionRoleRef: space.connectionRoleRef,
        secretRef: space.secretRef,
        schemaVersion: SHARED_DATABASE_SCHEMA_VERSION,
        plan: space.plan,
      });
      const row = inserted ?? (await this.repo.findSpaceBySlug(space.slug));
      if (!row) continue;
      if (inserted) created += 1;
      await this.repo.ensureSchemaRegistry(row.id, SHARED_DATABASE_SCHEMA_VERSION);
    }
    for (const space of spaces) emitSpaceRegistryChanged(space.slug);
    if (created > 0) this.logger.log(`Seeded ${created} existing space registration(s) into the control plane registry`);
    return created;
  }
}
