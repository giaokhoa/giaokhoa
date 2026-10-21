import { readFile, writeFile } from 'node:fs/promises';

// Bước sau `better-auth generate` trong lệnh `auth:generate` của apps/api.
// Công cụ Better Auth sinh mặc định pg_catalog.gen_random_uuid(); PostgreSQL 18 của dự án
// sử dụng uuidv7() cho bảng xác thực, nên sửa kết quả sinh thay vì sửa tay schema.
const path = new URL('../../../packages/database/src/schema/auth.generated.ts', import.meta.url);
const source = await readFile(path, 'utf8');
const from = 'pg_catalog.gen_random_uuid()';
const count = source.split(from).length - 1;

if (!count) throw new Error('Better Auth generated schema không có PostgreSQL UUID default');

await writeFile(path, source.replaceAll(from, 'uuidv7()'));
console.log(`Patched ${count} Better Auth UUID default(s) sang uuidv7().`);
