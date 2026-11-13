import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redisConnectionFromUrl } from './env';

const previousCa = process.env.REDIS_TLS_CA_FILE;
const created: string[] = [];

afterEach(() => {
  if (previousCa === undefined) delete process.env.REDIS_TLS_CA_FILE;
  else process.env.REDIS_TLS_CA_FILE = previousCa;
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Cấu hình kết nối Redis cho worker và healthcheck', () => {
  it('dùng Redis thường mà không tự tạo transport TLS', () => {
    delete process.env.REDIS_TLS_CA_FILE;
    const options = redisConnectionFromUrl('redis://localhost:6379');
    expect(options.tls).toBeUndefined();
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it('xác thực chứng chỉ Redis TLS bằng CA hệ thống khi không có CA riêng', () => {
    delete process.env.REDIS_TLS_CA_FILE;
    const options = redisConnectionFromUrl('rediss://redis.internal:6380');
    expect(options.tls).toEqual({ rejectUnauthorized: true });
    expect(options.host).toBe('redis.internal');
    expect(options.port).toBe(6380);
  });

  it('nạp CA nội bộ từ PEM và không vô hiệu hoá xác minh TLS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'giaokhoa-redis-tls-'));
    created.push(dir);
    const file = join(dir, 'ca.pem');
    writeFileSync(file, 'test-ca-pem');
    process.env.REDIS_TLS_CA_FILE = file;
    const options = redisConnectionFromUrl('rediss://redis.internal:6380');
    expect(options.tls).toEqual({ rejectUnauthorized: true, ca: 'test-ca-pem' });
  });
});
