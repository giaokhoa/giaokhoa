import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/postgres',
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int-spec.ts'],
        },
      },
      { test: { name: 'int', include: ['src/**/*.int-spec.ts'] } },
    ],
  },
});
