import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * Trần kết nối của pool nghiệp vụ phía worker (issue #586 — ngân sách kết nối của cụm): số kết nối tối đa mà tiến trình worker được mở tới kho nghiệp vụ. TUỲ CHỌN — chưa đặt thì giữ mặc định của thư viện `pg` như trước. Xem biến cùng tên phía api để biết cách cộng ngân sách toàn cụm.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(1000).optional(),
  // Bật TLS cho kết nối PostgreSQL khi nhà cung cấp bắt buộc (một số nhà cung cấp PostgreSQL chỉ nhận kết nối có mã hoá). Mặc định tắt:
  // môi trường local và CI chạy PostgreSQL thường không có TLS.
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DATABASE_TLS_CA_FILE: z.string().min(1).optional(),
  REDIS_TLS_CA_FILE: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  /**
   * URL kết nối của database CONTROL PLANE — worker đọc sổ đăng ký không gian qua biến này để khung định tuyến theo trung tâm
   * (issue #581) phân giải đích cho tác vụ nền. TUỲ CHỌN: chưa cấu
   * hình thì khung định tuyến báo chưa cấu hình khi được gọi, các đường kho chung của worker vẫn chạy như cũ. Giá trị là bí mật kết nối — không ghi ra log.
   */
  CONTROL_PLANE_DATABASE_URL: z.string().min(1).optional(),
  // Khung định tuyến kết nối theo trung tâm (issue #581) — cùng ngữ nghĩa và cùng giá trị mặc định với phía API: TTL đệm phân giải đích, trần kết nối cho pool của mỗi kho riêng, ngưỡng nhàn rỗi để đóng pool của kho không còn traffic.
  SPACE_ROUTING_CACHE_TTL_MS: z.coerce.number().int().positive().default(5_000),
  // Trần lượt quét outbox theo trung tâm chạy ĐỒNG THỜI ở mỗi nhịp relay (issue #582): mỗi lượt quét đang chạy giữ pool của kho riêng tương ứng mở, nên trần này là một phần của ngân sách kết nối của cụm — chỉ phía worker đọc biến này.
  SPACE_SWEEP_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SPACE_DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  // Trần số kho riêng có pool đồng thời trong MỘT tiến trình, khác
  // SPACE_DB_POOL_MAX là số kết nối tối đa BÊN TRONG mỗi pool.
  SPACE_DB_MAX_POOLS: z.coerce.number().int().positive().max(100).default(3),
  SPACE_DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  JWT_SECRET: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FILE_STORAGE_DIR: z.string().min(1).default('./data/files'),
  /** Cấu hình driver dùng chung với API để job cleanup xoá đúng backend vật lý. */
  FILE_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  FILE_STORAGE_S3_ENDPOINT: z.string().min(1).optional(),
  FILE_STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
  FILE_STORAGE_S3_BUCKET: z.string().min(1).optional(),
  FILE_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  FILE_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  FILE_STORAGE_S3_FORCE_PATH_STYLE: z.enum(['true','false']).default('false'),

  // Gửi mail thông báo qua Resend (NB-5, issue #174): cả hai đều tuỳ chọn — thiếu thì transport mail chạy chế độ ghi log có khai báo
  // (không gửi, không lỗi), trùng ngữ nghĩa với module mail phía API.
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Cấu hình DB giống API: bỏ sslmode trước khi bật xác minh CA. */
export function databaseConnectionFromEnv(url: string, ssl: boolean): string | PoolConfig {
  if (!ssl) return url;
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) parsed.searchParams.delete(key);
  const caFile = process.env.DATABASE_TLS_CA_FILE;
  const ca = caFile ? readFileSync(caFile, 'utf8') : undefined;
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

/** Redis TLS xác minh CA và cho phép mount CA nội bộ khi triển khai. */
export function redisTlsFromUrl(url: string): { tls?: { rejectUnauthorized: true; ca?: string } } {
  if (new URL(url).protocol !== 'rediss:') return {};
  const caFile = process.env.REDIS_TLS_CA_FILE;
  const ca = caFile ? readFileSync(caFile, 'utf8') : undefined;
  return { tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function redisConnectionFromUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: { rejectUnauthorized: true; ca?: string };
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    // rediss:// xác minh chứng chỉ qua CA hệ thống hoặc CA được mount.
    ...redisTlsFromUrl(url),
    maxRetriesPerRequest: null,
  };
}
