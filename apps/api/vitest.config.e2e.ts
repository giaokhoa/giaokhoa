import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// E2E chỉ dùng môi trường test; không được rơi về .env của ứng dụng.
const testEnvFile = '.env.test';
const { parsed, error } = config({ path: testEnvFile, override: true });
if (error || !parsed?.DATABASE_URL) {
  throw new Error('E2E requires apps/api/.env.test with DATABASE_URL');
}
if (!new URL(parsed.DATABASE_URL).pathname.includes('test')) {
  throw new Error('E2E DATABASE_URL must name an isolated test database');
}
process.env.DOTENV_CONFIG_PATH = testEnvFile;

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
  },
});
