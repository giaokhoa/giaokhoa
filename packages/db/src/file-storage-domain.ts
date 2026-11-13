export const SYSTEM_FILE_DOMAIN = 'bank-system';
export const LEGACY_FILE_DOMAIN = 'legacy';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SPACE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function fileDomainForSpace(spaceId: string): string {
  if (!SPACE_ID_PATTERN.test(spaceId)) throw new Error('file.invalid_space_id');
  return `space-${spaceId}`;
}

export function assertFileStorageDomain(domain: string, allowLegacy = false): void {
  if (domain === SYSTEM_FILE_DOMAIN) return;
  if (domain === LEGACY_FILE_DOMAIN && allowLegacy) return;
  if (domain.startsWith('space-') && SPACE_ID_PATTERN.test(domain.slice(6))) return;
  throw new Error('file.invalid_storage_domain');
}

export function fileContentKey(domain: string, hash: string): string {
  assertFileStorageDomain(domain, true);
  if (!HASH_PATTERN.test(hash)) throw new Error('file.invalid_content_hash');
  const suffix = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
  return domain === LEGACY_FILE_DOMAIN ? suffix : `${domain}/${suffix}`;
}
