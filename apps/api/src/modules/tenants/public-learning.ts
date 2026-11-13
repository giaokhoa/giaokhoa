export const PUBLIC_LEARNING_SLUG = 'cong-cong';

export function isPublicLearningHost(host: string | string[] | undefined): boolean {
  if (process.env.PUBLIC_LEARNING_ENABLED !== 'true') return false;
  const expected = process.env.BETTER_AUTH_URL;
  const candidate = Array.isArray(host) ? host[0] : host;
  if (!expected || !candidate || /[,/@?#\\\s]/.test(candidate)) return false;
  try {
    const hostname = new URL(expected).hostname.toLowerCase();
    const parsed = new URL(`http://${candidate}`);
    return Boolean(hostname) && !parsed.username && !parsed.password && parsed.hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}
