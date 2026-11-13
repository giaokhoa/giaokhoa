import type { PoolConfig } from 'pg';
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(1000).optional(),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  REDIS_URL: z.string().min(1),
  CONTROL_PLANE_DATABASE_URL: z.string().min(1).optional(),
  SPACE_ROUTING_CACHE_TTL_MS: z.coerce.number().int().positive().default(5_000),
  SPACE_SWEEP_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SPACE_DB_POOL_MAX: z.coerce.number().int().positive().default(5),
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
  MAIL_FROM: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function databaseConnectionFromEnv(url: string, ssl: boolean): string | PoolConfig {
  if (!ssl) return url;
  return { connectionString: url, ssl: { rejectUnauthorized: false } };
}

export function redisConnectionFromUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: { rejectUnauthorized: boolean };
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: { rejectUnauthorized: false } } : {}),
    maxRetriesPerRequest: null,
  };
}
