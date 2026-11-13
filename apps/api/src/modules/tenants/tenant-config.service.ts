import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SiteSetting } from '@giaokhoa/contracts';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import {
  SITE_SETTINGS,
  findSiteSetting,
  validateSiteSettingValue,
  type SiteSettingDefinition,
} from '../site-config/settings-registry';
import { SiteConfigRepository } from '@giaokhoa/db/repositories/site-config';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantConfigService {
  constructor(
    private readonly repo: TenantsRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly tenantContext: TenantContextService,
    private readonly siteConfig: SiteConfigRepository,
  ) {}

  private settingKey(def: SiteSettingDefinition): string {
    return `${def.component}/${def.name}`;
  }

  private async platformStoredValue(component: string, name: string): Promise<unknown> {
    return this.siteConfig.getStoredValue(component, name);
  }

  async getEffectiveValue<T = unknown>(tenantId: string, component: string, name: string): Promise<T | undefined> {
    const def = findSiteSetting(component, name);
    if (!def) return undefined;
    if (def.scope !== 'platform') {
      const row = await this.repo.getConfigValue(tenantId, this.settingKey(def));
      if (row) return row.value as T;
    }
    const stored = await this.platformStoredValue(component, name);
    return (stored === undefined ? def.defaultValue : stored) as T;
  }

  async getValueForCurrentTenant<T = unknown>(component: string, name: string): Promise<T | undefined> {
    const tenantId = this.tenantContext.currentTenantId();
    if (!tenantId) {
      const def = findSiteSetting(component, name);
      if (!def) return undefined;
      const stored = await this.platformStoredValue(component, name);
      return (stored === undefined ? def.defaultValue : stored) as T;
    }
    return this.getEffectiveValue<T>(tenantId, component, name);
  }

  async viewForTenant(tenantId: string, component: string, name: string): Promise<SiteSetting> {
    const def = findSiteSetting(component, name);
    if (!def) {
      throw new BadRequestException({
        message: `Unknown site setting ${component}/${name}`,
        code: 'site_config.unknown_setting',
      });
    }
    const tenantRow = def.scope === 'platform' ? undefined : await this.repo.getConfigValue(tenantId, this.settingKey(def));
    const platformStored = await this.platformStoredValue(def.component, def.name);
    return {
      component: def.component,
      name: def.name,
      type: def.type,
      defaultValue: def.defaultValue,
      value: tenantRow ? tenantRow.value : platformStored === undefined ? def.defaultValue : platformStored,
      source: tenantRow || platformStored !== undefined ? 'database' : 'default',
      scope: def.scope,
    };
  }

  async listForTenant(actorId: string, tenantId: string): Promise<SiteSetting[]> {
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    const canView =
      (await this.evaluator.hasCapability(actorId, 'tenant:viewall', tenantCtx.id)) ||
      (await this.evaluator.hasCapability(actorId, 'tenant:manage', tenantCtx.id));
    if (!canView) {
      throw new BadRequestException({
        message: 'Missing capability tenant:viewall in the active tenant',
        code: 'access.capability_denied',
      });
    }
    const views: SiteSetting[] = [];
    for (const def of SITE_SETTINGS) {
      if (def.scope === 'platform') continue;
      views.push(await this.viewForTenant(tenantId, def.component, def.name));
    }
    return views;
  }

  async setForTenant(
    actorId: string,
    tenantId: string,
    component: string,
    name: string,
    value: unknown,
  ): Promise<SiteSetting> {
    const def = this.requireTenantDefinition(component, name);
    await this.assertTenantSettingsManager(actorId, tenantId);
    const problem = validateSiteSettingValue(def, value);
    if (problem) {
      throw new BadRequestException({
        message: `Invalid value for ${component}/${name}: ${problem}`,
        code: 'site_config.invalid_value',
      });
    }
    const before = await this.getEffectiveValue(tenantId, component, name);
    await this.repo.upsertConfigValue(tenantId, this.settingKey(def), value);
    await this.insertAudit(tenantId, def, before, value, actorId);
    return this.viewForTenant(tenantId, component, name);
  }

  async clearForTenant(actorId: string, tenantId: string, component: string, name: string): Promise<SiteSetting> {
    const def = this.requireTenantDefinition(component, name);
    await this.assertTenantSettingsManager(actorId, tenantId);
    const existing = await this.repo.getConfigValue(tenantId, this.settingKey(def));
    if (!existing) {
      throw new NotFoundException({
        message: `Tenant setting ${component}/${name} has no tenant override`,
        code: 'site_config.override_not_found',
      });
    }
    const before = existing.value;
    await this.repo.deleteConfigValue(tenantId, this.settingKey(def));
    const after = await this.getEffectiveValue(tenantId, component, name);
    await this.insertAudit(tenantId, def, before, after, actorId);
    return this.viewForTenant(tenantId, component, name);
  }

  private requireTenantDefinition(component: string, name: string): SiteSettingDefinition {
    const def = findSiteSetting(component, name);
    if (!def) {
      throw new BadRequestException({
        message: `Unknown site setting ${component}/${name}`,
        code: 'site_config.unknown_setting',
      });
    }
    if (def.scope === 'platform') {
      throw new BadRequestException({
        message: `Setting ${component}/${name} is platform-scoped and cannot be overridden by a tenant`,
        code: 'site_config.platform_only',
      });
    }
    return def;
  }

  private async assertTenantSettingsManager(actorId: string, tenantId: string): Promise<void> {
    const tenantCtx = await this.contexts.ensureTenantContext(tenantId);
    await this.evaluator.requireCapability(actorId, 'tenant:manage', tenantCtx.id);
  }

  private async insertAudit(
    tenantId: string,
    def: SiteSettingDefinition,
    oldValue: unknown,
    newValue: unknown,
    actorId: string,
  ): Promise<void> {
    await this.siteConfig.insertAudit({
      settingKey: this.settingKey(def),
      oldValue,
      newValue,
      changedBy: actorId,
      tenantId,
    });
  }
}
