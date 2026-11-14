import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(1000).optional(),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DATABASE_TLS_CA_FILE: z.string().min(1).optional(),
  REDIS_TLS_CA_FILE: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  CONTROL_PLANE_DATABASE_URL: z.string().min(1).optional(),
  SPACE_ROUTING_CACHE_TTL_MS: z.coerce.number().int().positive().default(5_000),
  SPACE_SWEEP_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SPACE_DB_POOL_MAX: z.coerce.number().int().positive().default(3),


  SPACE_DB_MAX_POOLS: z.coerce.number().int().positive().max(100).default(6),
  SPACE_DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  JWT_SECRET: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FILE_STORAGE_DIR: z.string().min(1).default('./data/files'),
  FILE_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  FILE_STORAGE_S3_ENDPOINT: z.string().min(1).optional(),
  FILE_STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
  FILE_STORAGE_S3_BUCKET: z.string().min(1).optional(),
  FILE_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  FILE_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  FILE_STORAGE_S3_FORCE_PATH_STYLE: z.enum(['true','false']).default('false'),

  RESEND_API_KEY: z.string().min(1).optional(),

  RESEND_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().max(20).default(1),
  MAIL_FROM: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}


export function databaseConnectionFromEnv(url: string, ssl: boolean): string | PoolConfig {
  if (!ssl) return url;
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) parsed.searchParams.delete(key);
  const caFile = process.env.DATABASE_TLS_CA_FILE;
  const ca = caFile ? readFileSync(caFile, 'utf8') : undefined;
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}


export function redisTlsFromUrl(url: string): { tls?: { rejectUnauthorized: true; ca?: string } } {
  if (new URL(url).protocol !== 'rediss:') return {};
  const caFile = process.env.REDIS_TLS_CA_FILE;
  const ca = caFile ? readFileSync(caFile, 'utf8') : undefined;
  return { tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function redisConnectionFromUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: { rejectUnauthorized: true; ca?: string };
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,

    ...redisTlsFromUrl(url),
    maxRetriesPerRequest: null,
  };
}
