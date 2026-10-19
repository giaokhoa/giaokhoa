import { expect, test } from 'vitest';
import { envSchema } from './env.js';

const baseEnv = {
  PORT: '4000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/giaokhoa',
  S3_BUCKET: 'giaokhoa-images',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:4000',
  BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:5173, http://localhost:3001',
};

test('validates and transforms environment variables', () => {
  const env = envSchema.parse({
    ...baseEnv,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
  });

  expect(env.PORT).toBe(4000);
  expect(env.IMAGE_ORPHAN_TTL_HOURS).toBe(24);
  expect(env.BETTER_AUTH_TRUSTED_ORIGINS).toEqual([
    'http://localhost:5173',
    'http://localhost:3001',
  ]);
  expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  expect(env.RESEND_API_KEY).toBeUndefined();
  expect(() =>
    envSchema.parse({
      ...baseEnv,
      BETTER_AUTH_SECRET: 'short',
    }),
  ).toThrow();
});

test('requires auth provider secrets in pairs', () => {
  expect(() =>
    envSchema.parse({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'client-id',
    }),
  ).toThrow();

  expect(() =>
    envSchema.parse({
      ...baseEnv,
      RESEND_API_KEY: 're_test',
    }),
  ).toThrow();
});
