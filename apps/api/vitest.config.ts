import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.GIAOKHOA_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/giaokhoa_test_api',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-at-least-16-chars',
      NODE_ENV: 'test',
      PORT: '3100',
      PAYMENT_WEBHOOK_SECRET: 'test-only-payment-webhook-secret-0123456789',
      RATE_LIMIT_PER_MINUTE: '1000000',
      RATE_LIMIT_AUTH_PER_MINUTE: '1000000',
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.bench.spec.ts'],
        },
      },
      { test: { name: 'int', include: ['test/integration/**/*.int-spec.ts'] } },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e-spec.ts'],
        },
      },
      { test: { name: 'bench', include: ['src/**/*.bench.spec.ts'] } },
    ],
  },
});
