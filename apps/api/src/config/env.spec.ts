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

test('xác thực và chuyển đổi các biến môi trường', () => {
  const env = envSchema.parse({
    ...baseEnv,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
  });

  expect(env.PORT).toBe(4000);
  expect(env.FILE_ORPHAN_TTL_HOURS).toBe(24);
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

test('yêu cầu thông tin xác thực S3 theo từng cặp', () => {
  expect(() => envSchema.parse({ ...baseEnv, S3_ACCESS_KEY_ID: 'access-key' })).toThrow();
  expect(() => envSchema.parse({ ...baseEnv, S3_SECRET_ACCESS_KEY: 'secret-key' })).toThrow();
  expect(
    envSchema.safeParse({
      ...baseEnv,
      S3_ACCESS_KEY_ID: 'access-key',
      S3_SECRET_ACCESS_KEY: 'secret-key',
    }).success,
  ).toBe(true);
});

test('yêu cầu các khóa bí mật của nhà cung cấp xác thực theo từng cặp', () => {
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
