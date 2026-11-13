import type { SiteSetting, SiteSettingAuditEntry } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';


export function fetchSiteSettings() {
  return apiJson<SiteSetting[]>('/api/v1/site-config');
}

export function fetchSiteSettingAudit() {
  return apiJson<SiteSettingAuditEntry[]>('/api/v1/site-config/audit');
}

export function saveSiteSetting(input: { component: string; name: string; value: unknown }) {
  return apiJson(`/api/v1/site-config/${input.component}/${input.name}`, {
    method: 'PUT',
    body: JSON.stringify({ value: input.value }),
  });
}

export function resetSiteSetting(input: { component: string; name: string }) {
  return apiJson(`/api/v1/site-config/${input.component}/${input.name}`, { method: 'DELETE' });
}
