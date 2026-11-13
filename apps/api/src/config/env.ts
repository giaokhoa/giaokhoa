import type { PoolConfig } from 'pg';
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CONTROL_PLANE_DATABASE_URL: z.string().min(1).optional(),
  SYSTEM_BANK_DATABASE_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(1000).optional(),
  CONTROL_PLANE_POOL_MAX: z.coerce.number().int().positive().max(1000).optional(),
  SPACE_ROUTING_CACHE_TTL_MS: z.coerce.number().int().positive().default(5_000),
  SPACE_DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  PUBLIC_LEARNING_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SPACE_CONG_CONG_DATABASE_URL: z.string().min(1).optional(),
  SPACE_DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  REDIS_URL: z.string().min(1),
  MESSAGING_PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MESSAGING_PRESENCE_REFRESH_MS: z.coerce.number().int().positive().default(120_000),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(1).default(8),
  PASSWORD_MIN_DIGITS: z.coerce.number().int().min(0).default(1),
  PASSWORD_MIN_LOWER: z.coerce.number().int().min(0).default(1),
  PASSWORD_MIN_UPPER: z.coerce.number().int().min(0).default(1),
  PASSWORD_MIN_NONALNUM: z.coerce.number().int().min(0).default(0),
  LOCKOUT_THRESHOLD: z.coerce.number().int().min(0).default(5),
  LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().positive().default(20),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(30),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MFA_ENCRYPTION_KEY: z.string().min(16).optional(),
  MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OAUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_GOOGLE_CLIENT_SECRET:
    z.string().min(1).optional(),
  OAUTH_FACEBOOK_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_FACEBOOK_CLIENT_SECRET:
    z.string().min(1).optional(),
  OAUTH_GOOGLE_AUTHORIZE_URL: z.string().min(1).optional(),
  OAUTH_GOOGLE_TOKEN_URL: z.string().min(1).optional(),
  OAUTH_GOOGLE_USERINFO_URL: z.string().min(1).optional(),
  OAUTH_FACEBOOK_AUTHORIZE_URL: z.string().min(1).optional(),
  OAUTH_FACEBOOK_TOKEN_URL: z.string().min(1).optional(),
  OAUTH_FACEBOOK_USERINFO_URL: z.string().min(1).optional(),
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OAUTH_HANDOFF_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  WEB_APP_URL: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_REGISTRATION_PER_MINUTE: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(300),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:5173'),
  WEB_DIST_DIR: z.string().optional(),
  FILE_STORAGE_DIR: z.string().min(1).default('./data/files'),
  FILE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  FILE_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  FILE_STORAGE_S3_ENDPOINT: z.string().min(1).optional(),
  FILE_STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
  FILE_STORAGE_S3_BUCKET: z.string().min(1).optional(),
  FILE_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  FILE_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  FILE_STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  BETTER_AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().min(1).optional(),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  FACEBOOK_APP_ID: z.string().min(1).optional(),
  FACEBOOK_APP_SECRET: z.string().min(1).optional(),
  AUTH_CUTOVER_STAGE: z.enum(['off', 'bake']).default('off'),
  MCP_AS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MCP_PUBLIC_BASE_URL: z.string().min(1).optional(),
  MCP_RATE_READ_PER_HOUR: z.coerce.number().int().positive().default(300),
  MCP_RATE_CREATE_PER_HOUR: z.coerce.number().int().positive().default(120),
  MCP_RATE_PUBLISH_PER_HOUR: z.coerce.number().int().positive().default(10),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),
  SEPAY_IPN_IP_ALLOWLIST: z.string().optional(),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin123!'),
  ADMIN_EMAIL: z.string().min(3).default('admin@localhost'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }
  if (parsed.data.PUBLIC_LEARNING_ENABLED) {
    for (const key of ['BETTER_AUTH_URL', 'CONTROL_PLANE_DATABASE_URL', 'SPACE_CONG_CONG_DATABASE_URL', 'BETTER_AUTH_SECRET'] as const) {
      if (!parsed.data[key]) throw new Error(`PUBLIC_LEARNING_ENABLED=true requires ${key} (public requests must never fall back to the shared database)`);
    }
    if (!parsed.data.BETTER_AUTH_ENABLED) {
      throw new Error('PUBLIC_LEARNING_ENABLED=true requires BETTER_AUTH_ENABLED=true');
    }
  }
  return parsed.data;
}

export function databaseConnectionFromEnv(url: string, ssl: boolean): string | PoolConfig {
  if (!ssl) return url;
  return { connectionString: url, ssl: { rejectUnauthorized: false } };
}

export function redisTlsFromUrl(url: string): { tls?: { rejectUnauthorized: boolean } } {
  return new URL(url).protocol === 'rediss:' ? { tls: { rejectUnauthorized: false } } : {};
}

export function cacheRedisConfigFromUrl(url: string): {
  url: string;
  socket?: { tls: true; rejectUnauthorized: false };
} {
  if (new URL(url).protocol === 'rediss:') {
    return { url, socket: { tls: true, rejectUnauthorized: false } };
  }
  return { url };
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
