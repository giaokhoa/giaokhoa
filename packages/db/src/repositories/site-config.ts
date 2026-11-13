import { sql, type RawBuilder } from 'kysely';
import type { CentreDb } from '../client';
import type { Json } from '../types/centre-db';

export interface AuditRow {
  id: string;
  settingKey: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  tenantId: string | null;
  createdAt: Date;
}

function jsonbValue(value: unknown): RawBuilder<Json> {
  return sql<Json>`${JSON.stringify(value as Json)}::jsonb`;
}

function storedJsonb(value: unknown): RawBuilder<Json> | null {
  return value === null || value === undefined ? null : jsonbValue(value);
}

const AUDIT_COLUMNS = [
  'id',
  'setting_key as settingKey',
  'old_value as oldValue',
  'new_value as newValue',
  'changed_by as changedBy',
  'tenant_id as tenantId',
  'created_at as createdAt',
] as const;

export class SiteConfigRepository {
  constructor(private readonly handle: CentreDb) {}

  async getStoredValue(component: string, name: string): Promise<unknown> {
    if (component === 'core') {
      const row = await this.handle
        .selectFrom('config')
        .select(['value'])
        .where('key', '=', name)
        .executeTakeFirst();
      return row ? row.value : undefined;
    }
    const row = await this.handle
      .selectFrom('plugin_config')
      .select(['value'])
      .where('plugin', '=', component)
      .where('name', '=', name)
      .where('tenant_id', 'is', null)
      .executeTakeFirst();
    if (!row || row.value === null) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return row.value;
    }
  }

  async storeValue(component: string, name: string, value: unknown): Promise<void> {
    if (component === 'core') {
      const stored = storedJsonb(value);
      await this.handle
        .insertInto('config')
        .values({ key: name, value: stored })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: stored, updated_at: new Date() }))
        .execute();
      return;
    }
    await this.handle
      .insertInto('plugin_config')
      .values({ plugin: component, name, value: JSON.stringify(value) })
      .onConflict((oc) => oc
        .columns(['plugin', 'name'])
        .where('tenant_id', 'is', null)
        .doUpdateSet({ value: JSON.stringify(value) }))
      .execute();
  }

  async deleteValue(component: string, name: string): Promise<void> {
    if (component === 'core') {
      await this.handle.deleteFrom('config').where('key', '=', name).execute();
      return;
    }
    await this.handle
      .deleteFrom('plugin_config')
      .where('plugin', '=', component)
      .where('name', '=', name)
      .where('tenant_id', 'is', null)
      .execute();
  }

  async insertAudit(entry: {
    settingKey: string;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
    tenantId?: string | null;
  }): Promise<void> {
    await this.handle
      .insertInto('admin_setting_audit')
      .values({
        setting_key: entry.settingKey,
        old_value: storedJsonb(entry.oldValue ?? null),
        new_value: storedJsonb(entry.newValue ?? null),
        changed_by: entry.changedBy,
        tenant_id: entry.tenantId ?? null,
      })
      .execute();
  }

  async listAudit(settingKey?: string): Promise<AuditRow[]> {
    let query = this.handle.selectFrom('admin_setting_audit').select(AUDIT_COLUMNS);
    if (settingKey) {
      query = query.where('setting_key', '=', settingKey);
    }
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows as AuditRow[];
  }
}
