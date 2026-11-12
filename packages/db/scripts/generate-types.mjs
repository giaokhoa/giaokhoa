/**
 * Lệnh `db:types` của `@giaokhoa/db`: sinh lại cả ba file kiểu Kysely
 * (`src/types/centre-db.d.ts`, `src/types/control-plane-db.d.ts`,
 * `src/types/system-bank-db.d.ts`) từ cơ sở dữ liệu THẬT dựng từ rỗng
 * bằng đúng bộ SQL đang mang dữ liệu hiện hành (carrier), rồi chạy
 * kysely-codegen cho từng kho.
 *
 * Luồng cho mỗi kho:
 *   1. Tạo database tạm riêng cho từng lượt sinh kiểu, dùng hậu tố
 *      ngẫu nhiên để nhiều worktree không ghi đè nhau; xoá khi xong.
 *   2. Dùng lại `buildTestDatabase` (đã biên dịch trong `dist/`) để
 *      áp CHÍNH pipeline `applyStoreMigrations` của Kysely, gồm cả
 *      shim PostgreSQL cũ và nhật ký migration. Không tự replay SQL.
 *   3. Chạy CLI kysely-codegen với file cấu hình riêng của kho
 *      (`scripts/codegen/<kho>.json`: override từng cột jsonb có
 *      khai báo kiểu tường minh + customImports trỏ về nơi định
 *      nghĩa kiểu thật) và ghi ra `src/types/<kho>-db.d.ts`.
 *
 * Kết nối quản trị lấy từ biến môi trường `DB_TYPES_ADMIN_URL`; thiếu
 * biến này thì suy từ `DATABASE_URL` bằng cách thay tên database
 * thành `postgres`. Cả hai đều vắng thì lệnh dừng với lỗi rõ ràng —
 * cổng chống lệch (drift) trong CI chạy lệnh này rồi kiểm
 * `git diff --exit-code` trên `src/types/`, nên đầu ra phải tái lập
 * y hệt trên mọi máy cùng phiên bản PostgreSQL 18. Chạy build `@giaokhoa/db`
 * trước lệnh này để test-support đã được biên dịch mới nhất.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tái sử dụng đúng harness dựng database test của package đã build. */
const require = createRequire(import.meta.url);
const { buildTestDatabase, dropTestDatabase } = require('../dist/test-support/build-test-database.js');

/** Ba kho dữ liệu và vị trí carrier/codegen tương ứng của từng kho. */
const STORES = [
  {
    key: 'centre',
    database: 'giaokhoa_types_centre',
    configFile: join(packageDir, 'scripts', 'codegen', 'centre.json'),
    outFile: join(packageDir, 'src', 'types', 'centre-db.d.ts'),
  },
  {
    key: 'control-plane',
    database: 'giaokhoa_types_control_plane',
    configFile: join(packageDir, 'scripts', 'codegen', 'control-plane.json'),
    outFile: join(packageDir, 'src', 'types', 'control-plane-db.d.ts'),
  },
  {
    key: 'system-bank',
    database: 'giaokhoa_types_system_bank',
    configFile: join(packageDir, 'scripts', 'codegen', 'system-bank.json'),
    outFile: join(packageDir, 'src', 'types', 'system-bank-db.d.ts'),
  },
];

/** Suy URL của một database cụ thể từ URL quản trị. */
function databaseUrl(adminUrl, database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Lấy URL quản trị: ưu tiên `DB_TYPES_ADMIN_URL`, sau đó suy từ `DATABASE_URL`. */
function resolveAdminUrl() {
  if (process.env.DB_TYPES_ADMIN_URL) return process.env.DB_TYPES_ADMIN_URL;
  if (process.env.DATABASE_URL) return databaseUrl(process.env.DATABASE_URL, 'postgres');
  throw new Error(
    'Thiếu kết nối quản trị: đặt DB_TYPES_ADMIN_URL (hoặc DATABASE_URL) trỏ tới cụm PostgreSQL đích trước khi chạy db:types.',
  );
}

/** Dựng database của một kho từ rỗng rồi chạy kysely-codegen cho kho đó. */
async function generateStore(adminUrl, store) {
  // Harness dùng lại Kysely Migrator và chính migration hiện hành,
  // tránh script codegen diễn giải SQL khác production/test.
  const database = `${store.database}_${randomUUID().slice(0, 8)}`;
  try {
    const storeUrl = await buildTestDatabase({
      adminUrl,
      database,
      store: store.key,
    });

    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'kysely-codegen',
        '--config-file', store.configFile,
        '--url', storeUrl,
        '--out-file', store.outFile,
        // Kysely Migrator tạo thêm hai bảng nhật ký kỹ thuật mà pipeline
        // replay SQL cũ không có; không sinh chúng vào schema nghiệp vụ.
        '--exclude-pattern', 'public.kysely_migration*',
      ],
      { cwd: packageDir, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`kysely-codegen thất bại cho kho ${store.key} (mã thoát ${result.status}).`);
    }
    console.log(`db:types — đã sinh ${store.outFile} từ database ${database}.`);
  } finally {
    // Xóa DB tạm kể cả khi migration/codegen thất bại; mỗi lượt có
    // hậu tố riêng nên không đụng database của worktree đang chạy khác.
    await dropTestDatabase(adminUrl, database);
  }
}

const adminUrl = resolveAdminUrl();
for (const store of STORES) {
  await generateStore(adminUrl, store);
}
