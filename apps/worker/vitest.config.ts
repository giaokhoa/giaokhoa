import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
      {
        test: {
          name: 'int',
          include: ['test/integration/**/*.int-spec.ts'],
          fileParallelism: false,
        },
      },
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: process.env.GIAOKHOA_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/giaokhoa_test_worker',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-at-least-16-chars',
      NODE_ENV: 'test',
      FILE_STORAGE_DIR: '/tmp/giaokhoa-worker-test-files',
    },
  },
});
