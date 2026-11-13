import i18n from '#config/i18n';

export function titleMeta(title: string): { title: string }[] {
  return [{ title: `${title} · Giáo khoa` }];
}

export function appKeyMeta(key: string): { title: string }[] {
  return titleMeta(i18n.t(key, { ns: 'app' }));
}

export function platformKeyMeta(key: string): { title: string }[] {
  return titleMeta(i18n.t(key, { ns: 'platform' }));
}

export function guardianKeyMeta(key: string): { title: string }[] {
  return titleMeta(i18n.t(key, { ns: 'guardian' }));
}
