import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SiteSetting, SiteSettingAuditEntry } from '@giaokhoa/contracts';
import {
  MESSAGE_PROVIDERS,
  NOTIFICATION_POLICY_COMPONENT,
  notificationPolicySettingName,
} from '../messaging/notification-providers';
import { SiteConfigRepository } from '@giaokhoa/db/repositories/site-config';
import {
  SITE_SETTINGS,
  findSiteSetting,
  validateSiteSettingValue,
  type SiteSettingDefinition,
} from './settings-registry';

@Injectable()
export class SiteConfigService {
  constructor(private readonly repo: SiteConfigRepository) {}

  private settingKey(def: SiteSettingDefinition): string {
    return `${def.component}/${def.name}`;
  }

  private async toView(def: SiteSettingDefinition): Promise<SiteSetting> {
    const stored = await this.repo.getStoredValue(def.component, def.name);
    return {
      component: def.component,
      name: def.name,
      type: def.type,
      defaultValue: def.defaultValue,
      value: stored === undefined ? def.defaultValue : stored,
      source: stored === undefined ? 'default' : 'database',
      scope: def.scope,
    };
  }

  private requireDefinition(component: string, name: string): SiteSettingDefinition {
    const def = findSiteSetting(component, name);
    if (!def) {
      throw new BadRequestException({
        message: `Unknown site setting ${component}/${name}`,
        code: 'site_config.unknown_setting',
      });
    }
    return def;
  }

  async listSettings(): Promise<SiteSetting[]> {
    const views: SiteSetting[] = [];
    for (const def of SITE_SETTINGS) views.push(await this.toView(def));
    return views;
  }

  async getSetting(component: string, name: string): Promise<SiteSetting> {
    return this.toView(this.requireDefinition(component, name));
  }

  async getValue<T extends string | number | boolean>(component: string, name: string): Promise<T | undefined> {
    const def = findSiteSetting(component, name);
    if (!def) return undefined;
    const stored = await this.repo.getStoredValue(component, name);
    return (stored === undefined ? def.defaultValue : stored) as T;
  }

  async setSetting(
    actorId: string,
    component: string,
    name: string,
    value: unknown,
  ): Promise<SiteSetting> {
    const def = this.requireDefinition(component, name);
    const problem = validateSiteSettingValue(def, value);
    if (problem) {
      throw new BadRequestException({
        message: `Invalid value for ${component}/${name}: ${problem}`,
        code: 'site_config.invalid_value',
      });
    }
    if (def.component === NOTIFICATION_POLICY_COMPONENT && value === false) {
      const provider = MESSAGE_PROVIDERS.find((p) => notificationPolicySettingName(p.name) === def.name);
      if (provider?.mandatoryInApp) {
        throw new BadRequestException({
          message: `Notification type ${provider.name} is mandatory and cannot be disabled at site level`,
          code: 'site_config.notification_mandatory',
        });
      }
    }
    const before = await this.toView(def);
    await this.repo.storeValue(component, name, value);
    await this.repo.insertAudit({
      settingKey: this.settingKey(def),
      oldValue: before.value,
      newValue: value,
      changedBy: actorId,
    });
    return this.toView(def);
  }

  async clearSetting(actorId: string, component: string, name: string): Promise<SiteSetting> {
    const def = this.requireDefinition(component, name);
    const before = await this.toView(def);
    if (before.source === 'default') {
      throw new NotFoundException({
        message: `Site setting ${component}/${name} has no stored override`,
        code: 'site_config.override_not_found',
      });
    }
    await this.repo.deleteValue(component, name);
    await this.repo.insertAudit({
      settingKey: this.settingKey(def),
      oldValue: before.value,
      newValue: def.defaultValue,
      changedBy: actorId,
    });
    return this.toView(def);
  }

  async listAudit(settingKey?: string): Promise<SiteSettingAuditEntry[]> {
    const rows = await this.repo.listAudit(settingKey);
    return rows.slice(0, 100).map((row) => ({
      id: row.id,
      settingKey: row.settingKey,
      oldValue: row.oldValue,
      newValue: row.newValue,
      changedBy: row.changedBy,
      tenantId: row.tenantId ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
