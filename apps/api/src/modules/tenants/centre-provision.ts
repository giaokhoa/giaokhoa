import { createHash, randomBytes } from 'node:crypto';
import { SPACE_LABEL_PATTERN } from './space-resolution';

export const CENTRE_DATABASE_PREFIX = 'giaokhoa_space_';
export const CENTRE_ROLE_PREFIX = 'giaokhoa_role_';
export const POSTGRES_IDENTIFIER_LIMIT = 63;
export const CENTRE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CENTRE_PROGRAM_PACKAGE_KEY = 'gdpt-2018';

export const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

export function normalizeSpaceSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (!SPACE_LABEL_PATTERN.test(slug)) {
    throw new Error(
      `Invalid space slug "${raw}": expected a DNS label (lowercase letters, digits, hyphens, at most 63 characters)`,
    );
  }
  return slug;
}

export function deriveCentreDatabaseName(slug: string): string {
  return derivePostgresIdentifier(CENTRE_DATABASE_PREFIX, slug);
}

export function deriveCentreRoleName(slug: string): string {
  return derivePostgresIdentifier(CENTRE_ROLE_PREFIX, slug);
}

export function deriveCentreSecretEnvVar(slug: string): string {
  return `SPACE_${slug.toUpperCase().replaceAll('-', '_')}_DATABASE_URL`;
}

export function generateCentreDatabasePassword(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(24);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function generateCentreInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCentreInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function buildCentreDatabaseUrl(parts: {
  host: string;
  port: number;
  role: string;
  password: string;
  databaseName: string;
}): string {
  return `postgres://${parts.role}:${encodeURIComponent(parts.password)}@${parts.host}:${parts.port}/${parts.databaseName}`;
}

function derivePostgresIdentifier(prefix: string, slug: string): string {
  const body = slug.replaceAll('-', '_');
  const full = `${prefix}${body}`;
  if (full.length <= POSTGRES_IDENTIFIER_LIMIT) return full;
  const keep = POSTGRES_IDENTIFIER_LIMIT - prefix.length - 9;
  const hash = createHash('sha256').update(slug).digest('hex').slice(0, 8);
  return `${prefix}${body.slice(0, keep)}_${hash}`;
}
