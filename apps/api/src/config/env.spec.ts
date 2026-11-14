import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cacheRedisConfigFromUrl,
  databaseConnectionFromEnv,
  redisConnectionFromUrl,
  redisTlsFromUrl,
  validateEnv,
} from './env';

describe('Hàm validateEnv (fail-fast)', () => {
  it('chấp nhận env hợp lệ', () => {
    const env = validateEnv({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/giaokhoa',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a-secret-with-16+chars',
    });
    expect(env.PORT).toBe(3000);
  });

  it('chấp nhận đúng email bootstrap của Compose và vẫn chặn email tùy ý sai định dạng', () => {
    const base = {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/giaokhoa',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a-secret-with-16+chars',
    };
    expect(validateEnv(base).ADMIN_EMAIL).toBe('admin@localhost');
    expect(validateEnv({ ...base, ADMIN_EMAIL: 'admin@localhost' }).ADMIN_EMAIL)
      .toBe('admin@localhost');
    expect(validateEnv({ ...base, ADMIN_EMAIL: 'admin@example.org' }).ADMIN_EMAIL)
      .toBe('admin@example.org');
    expect(() => validateEnv({ ...base, ADMIN_EMAIL: 'not-an-email' }))
      .toThrow(/Invalid environment variables/);
    expect(() => validateEnv({ ...base, ADMIN_EMAIL: 'somebody@internal' }))
      .toThrow(/Invalid environment variables/);
  });

  it('production từ chối mật khẩu quản trị mặc định, thiếu hoặc yếu trước khi khởi động', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/giaokhoa',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a-secret-with-16+chars',
    };
    for (const password of [undefined, 'Admin123!', 'weakpass']) {
      expect(() => validateEnv({ ...base, ADMIN_PASSWORD: password })).toThrow(
        /ADMIN_PASSWORD/,
      );
    }
    expect(
      validateEnv({ ...base, ADMIN_PASSWORD: 'ProductionSecretLongEnough!' })
        .ADMIN_PASSWORD,
    ).toBe('ProductionSecretLongEnough!');
    expect(validateEnv({ ...base, NODE_ENV: 'test' }).ADMIN_PASSWORD).toBe(
      'Admin123!',
    );
  });

  it('production có operator riêng chỉ khởi động khi mật khẩu riêng không còn là mật khẩu demo', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/giaokhoa',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a-secret-with-16+chars',
      ADMIN_PASSWORD: 'ProductionSecretLongEnough!',
      PLATFORM_ADMIN_USERNAME: 'operator',
    };
    for (const password of [undefined, 'Platform123!', 'weakpass']) {
      expect(() =>
        validateEnv({ ...base, PLATFORM_ADMIN_PASSWORD: password }),
      ).toThrow(/PLATFORM_ADMIN_PASSWORD/);
    }
    expect(() =>
      validateEnv({
        ...base,
        PLATFORM_ADMIN_PASSWORD: 'AnotherProductionSecret!',
      }),
    ).not.toThrow();
  });

  it('từ chối khi thiếu DATABASE_URL', () => {
    expect(() =>
      validateEnv({ REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'a-secret-with-16+chars' }),
    ).toThrow(/Invalid environment variables/);
  });

  it('mặc định DATABASE_SSL là false và phân tích cờ true', () => {
    const base = {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/giaokhoa',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a-secret-with-16+chars',
    };
    expect(validateEnv(base).DATABASE_SSL).toBe(false);
    expect(validateEnv({ ...base, DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
  });

  it('từ chối giá trị DATABASE_SSL không hợp lệ', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/giaokhoa',
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'a-secret-with-16+chars',
        DATABASE_SSL: 'yes',
      }),
    ).toThrow(/Invalid environment variables/);
  });

  it('từ chối JWT_SECRET quá ngắn', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'short',
      }),
    ).toThrow(/Invalid environment variables/);
  });
});

describe('Hàm databaseConnectionFromEnv', () => {
  it('trả URL thuần khi SSL tắt', () => {
    expect(databaseConnectionFromEnv('postgres://localhost/giaokhoa', false)).toBe(
      'postgres://localhost/giaokhoa',
    );
  });

  it('trả PoolConfig có SSL khi cờ đang bật', () => {
    expect(databaseConnectionFromEnv('postgres://db.example.com/giaokhoa', true)).toEqual({
      connectionString: 'postgres://db.example.com/giaokhoa',
      ssl: { rejectUnauthorized: true },
    });
  });
});

describe('Xác minh chứng chỉ TLS', () => {
  it('không để sslmode=no-verify ghi đè xác minh CA của PostgreSQL', () => {
    const result = databaseConnectionFromEnv(
      'postgres://db.example.com/giaokhoa?sslmode=no-verify', true,
    );
    expect(result).toEqual({
      connectionString: 'postgres://db.example.com/giaokhoa',
      ssl: { rejectUnauthorized: true },
    });
  });

  it('đọc CA nội bộ từ file khi đặt các biến đường dẫn và từ chối file sai', () => {
    const dir = mkdtempSync(join(tmpdir(), 'giaokhoa-tls-test-'));
    const certFile = join(dir, 'ca.pem');
    writeFileSync(certFile, 'test-ca-data');
    const oldDb = process.env.DATABASE_TLS_CA_FILE;
    const oldRedis = process.env.REDIS_TLS_CA_FILE;
    try {
      process.env.DATABASE_TLS_CA_FILE = certFile;
      process.env.REDIS_TLS_CA_FILE = certFile;
      expect(databaseConnectionFromEnv('postgres://db.example.com/app', true)).toMatchObject({
        ssl: { rejectUnauthorized: true, ca: 'test-ca-data' },
      });
      expect(redisTlsFromUrl('rediss://redis.example.com')).toEqual({
        tls: { rejectUnauthorized: true, ca: 'test-ca-data' },
      });
      process.env.DATABASE_TLS_CA_FILE = join(dir, 'missing.pem');
      expect(() => databaseConnectionFromEnv('postgres://db.example.com/app', true)).toThrow();
    } finally {
      if (oldDb === undefined) delete process.env.DATABASE_TLS_CA_FILE;
      else process.env.DATABASE_TLS_CA_FILE = oldDb;
      if (oldRedis === undefined) delete process.env.REDIS_TLS_CA_FILE;
      else process.env.REDIS_TLS_CA_FILE = oldRedis;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Hàm redisConnectionFromUrl', () => {
  it('phân tích URL redis:// thuần không có TLS', () => {
    const conn = redisConnectionFromUrl('redis://localhost:6379');
    expect(conn.host).toBe('localhost');
    expect(conn.port).toBe(6379);
    expect(conn.tls).toBeUndefined();

    expect(conn).toMatchObject({ maxRetriesPerRequest: 1, enableOfflineQueue: false });
  });

  it('bật TLS cho URL rediss://', () => {
    const conn = redisConnectionFromUrl('rediss://user:pass@redis.example.com:6380');
    expect(conn.host).toBe('redis.example.com');
    expect(conn.port).toBe(6380);
    expect(conn.tls).toEqual({ rejectUnauthorized: true });
  });
});

describe('Hàm redisTlsFromUrl', () => {
  it('không trả tuỳ chọn TLS nào cho URL redis:// thuần', () => {
    expect(redisTlsFromUrl('redis://localhost:6379')).toEqual({});
  });

  it('xác minh CA chứng chỉ cho URL rediss://', () => {
    expect(redisTlsFromUrl('rediss://redis.example.com:6380')).toEqual({
      tls: { rejectUnauthorized: true },
    });
  });
});

describe('Hàm cacheRedisConfigFromUrl', () => {
  it('cho URL redis:// thuần đi qua nguyên vẹn', () => {
    expect(cacheRedisConfigFromUrl('redis://localhost:6379')).toEqual({
      url: 'redis://localhost:6379',
    });
  });

  it('thêm socket TLS không xác minh cho URL rediss://', () => {
    expect(cacheRedisConfigFromUrl('rediss://redis.example.com:6380')).toEqual({
      url: 'rediss://redis.example.com:6380',
      socket: { tls: true, rejectUnauthorized: true },
    });
  });
});
