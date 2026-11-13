import {
  MESSAGE_PROVIDERS,
  NOTIFICATION_POLICY_COMPONENT,
  notificationPolicySettingName,
} from '../messaging/notification-providers';

export type SiteSettingType = 'string' | 'number' | 'boolean' | 'enum';

export type SiteSettingScope = 'platform' | 'tenant' | 'both';

export interface SiteSettingDefinition {
  component: string;
  name: string;
  type: SiteSettingType;
  options?: readonly string[];
  defaultValue: string | number | boolean;
  scope: SiteSettingScope;
}

export const SITE_SETTINGS: readonly SiteSettingDefinition[] = [
  { component: 'core', name: 'fullname', type: 'string', defaultValue: 'Giáo khoa', scope: 'both' },
  { component: 'core', name: 'lang', type: 'enum', options: ['vi', 'en'], defaultValue: 'vi', scope: 'both' },
  { component: 'core', name: 'timezone', type: 'string', defaultValue: 'Asia/Saigon', scope: 'both' },
  { component: 'core', name: 'sitepolicy', type: 'string', defaultValue: '', scope: 'platform' },
  { component: 'core', name: 'messagingallusers', type: 'boolean', defaultValue: false, scope: 'platform' },
  { component: 'core', name: 'messagingrecallwindowminutes', type: 'number', defaultValue: 15, scope: 'both' },
  { component: 'core', name: 'messagingmaxmessagelength', type: 'number', defaultValue: 10000, scope: 'both' },
  { component: 'core', name: 'messagingsendburstlimit', type: 'number', defaultValue: 20, scope: 'platform' },
  { component: 'core', name: 'messagingsendburstwindowseconds', type: 'number', defaultValue: 10, scope: 'platform' },
  { component: 'core', name: 'messagingsendperminutelimit', type: 'number', defaultValue: 60, scope: 'platform' },
  { component: 'badges', name: 'enabled', type: 'boolean', defaultValue: true, scope: 'both' },
  { component: 'exam', name: 'requireboardapproval', type: 'boolean', defaultValue: false, scope: 'both' },
  { component: 'mod_quiz', name: 'omrfilldensity', type: 'number', defaultValue: 0.42, scope: 'platform' },
  { component: 'mod_quiz', name: 'omrblankdensity', type: 'number', defaultValue: 0.16, scope: 'platform' },
  { component: 'mod_quiz', name: 'omrminmargin', type: 'number', defaultValue: 0.1, scope: 'platform' },
  { component: 'mod_quiz', name: 'paperscanretentionmonths', type: 'number', defaultValue: 18, scope: 'platform' },
  { component: 'payments', name: 'tenantplanprice', type: 'number', defaultValue: 6000000, scope: 'platform' },
  { component: 'payments', name: 'tenantplanperioddays', type: 'number', defaultValue: 365, scope: 'platform' },
  { component: 'payments', name: 'teacherplanprice', type: 'number', defaultValue: 990000, scope: 'platform' },
  { component: 'payments', name: 'teacherplanperioddays', type: 'number', defaultValue: 365, scope: 'platform' },
  { component: 'payments', name: 'tenantplanslots', type: 'number', defaultValue: 30, scope: 'platform' },
  { component: 'payments', name: 'teacherplancourseslots', type: 'number', defaultValue: 10, scope: 'platform' },
  { component: 'payments', name: 'tenantplanfreeslots', type: 'number', defaultValue: 3, scope: 'platform' },
  { component: 'payments', name: 'teacherplanfreecourseslots', type: 'number', defaultValue: 1, scope: 'platform' },
  { component: 'payments', name: 'plangracedays', type: 'number', defaultValue: 7, scope: 'platform' },
  { component: 'payments', name: 'refunddualapprovalthreshold', type: 'number', defaultValue: 1000000, scope: 'both' },
  { component: 'payments', name: 'reviewtargethours', type: 'number', defaultValue: 48, scope: 'both' },
  ...MESSAGE_PROVIDERS.map((provider) => ({
    component: NOTIFICATION_POLICY_COMPONENT,
    name: notificationPolicySettingName(provider.name),
    type: 'boolean' as const,
    defaultValue: true,
    scope: 'platform' as const,
  })),
];

export function findSiteSetting(component: string, name: string): SiteSettingDefinition | undefined {
  return SITE_SETTINGS.find((s) => s.component === component && s.name === name);
}

export function validateSiteSettingValue(def: SiteSettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected a boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expected a finite number';
    case 'string':
      return typeof value === 'string' && value.length <= 1000 ? null : 'expected a string of at most 1000 characters';
    case 'enum':
      return typeof value === 'string' && (def.options ?? []).includes(value)
        ? null
        : `expected one of: ${(def.options ?? []).join(', ')}`;
  }
}
