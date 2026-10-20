export function safeRedirectPath(value: string | null, fallback = '/') {
  if (!value?.startsWith('/') || value.includes('\\')) return fallback;

  try {
    const origin = 'https://local.invalid';
    const target = new URL(value, origin);
    return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch {
    return fallback;
  }
}
