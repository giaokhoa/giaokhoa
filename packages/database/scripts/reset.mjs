import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

config({ path: fileURLToPath(new URL('../../../apps/api/.env', import.meta.url)) });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL phải được cấu hình.');
const database = new URL(url);
if (!['db', 'postgres', 'localhost', '127.0.0.1', '[::1]'].includes(database.hostname))
  throw new Error('Từ chối reset cơ sở dữ liệu không phải local.');

const pool = new Pool({ connectionString: url });
try {
  await pool.query(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  );
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log(`Đã reset và di trú cơ sở dữ liệu local ${database.pathname.slice(1)}.`);
} finally {
  await pool.end();
}
