import { defineConfig } from 'vitest/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.includes('test')) {
  throw new Error('Kiểm thử tích hợp cần DATABASE_URL trỏ đến cơ sở dữ liệu kiểm thử riêng');
}

export default defineConfig({
  test: {
    include: ['test/*.spec.ts'],
    fileParallelism: false,
  },
});
