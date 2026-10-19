import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../../../packages/database/src/schema/auth.generated.ts', import.meta.url);
const source = await readFile(path, 'utf8');
const from = 'pg_catalog.gen_random_uuid()';
const count = source.split(from).length - 1;

if (!count) throw new Error('Better Auth generated schema không có PostgreSQL UUID default');

await writeFile(path, source.replaceAll(from, 'uuidv7()'));
console.log(`Patched ${count} Better Auth UUID default(s) sang uuidv7().`);
