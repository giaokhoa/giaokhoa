/**
 * Miền sở hữu byte vật lý của tệp: ID đăng ký bất biến của không gian
 * (không dùng slug/hostname), ngân hàng hệ thống, hoặc bố cục legacy.
 * Chỉ khoá đã kiểm định mới được ghép vào đường dẫn local/S3.
 */
export const SYSTEM_FILE_DOMAIN = 'bank-system';
export const LEGACY_FILE_DOMAIN = 'legacy';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SPACE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Trả miền ổn định cho trung tâm/khu công cộng từ ID của sổ đăng ký. */
export function fileDomainForSpace(spaceId: string): string {
  if (!SPACE_ID_PATTERN.test(spaceId)) throw new Error('file.invalid_space_id');
  return `space-${spaceId}`;
}

/** Không chấp nhận miền do client/job tự đặt hoặc thành phần có thể thoát thư mục. */
export function assertFileStorageDomain(domain: string, allowLegacy = false): void {
  if (domain === SYSTEM_FILE_DOMAIN) return;
  if (domain === LEGACY_FILE_DOMAIN && allowLegacy) return;
  if (domain.startsWith('space-') && SPACE_ID_PATTERN.test(domain.slice(6))) return;
  throw new Error('file.invalid_storage_domain');
}

/** Khoá vật lý có miền; legacy chỉ hỗ trợ đọc file cũ chưa di trú. */
export function fileContentKey(domain: string, hash: string): string {
  assertFileStorageDomain(domain, true);
  if (!HASH_PATTERN.test(hash)) throw new Error('file.invalid_content_hash');
  const suffix = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
  return domain === LEGACY_FILE_DOMAIN ? suffix : `${domain}/${suffix}`;
}
