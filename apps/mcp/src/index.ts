import { CurriculumService } from '@giaokhoa/application/curriculum/service';
import { PostgresCurriculumRepository } from '@giaokhoa/database/curriculum';
import * as schema from '@giaokhoa/database/schema';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { registerCurriculumTools } from './curriculum-tools.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL phải được cấu hình.');

const pool = new Pool({
  connectionString: databaseUrl,
  allowExitOnIdle: true,
});

const db = drizzle(pool, { schema });
const curriculum = new CurriculumService(new PostgresCurriculumRepository(db));

void serveStdio(() => {
  const server = new McpServer({
    name: 'giaokhoa',
    version: '0.0.1',
  });

  registerCurriculumTools(server, curriculum);
  return server;
});
