import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClientError } from '@giaokhoa/application/common/client-error';
import { CurriculumService } from '@giaokhoa/application/curriculum/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import { PostgresCurriculumRepository } from '@giaokhoa/database/curriculum';
import * as schema from '@giaokhoa/database/schema';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';
import { registerCurriculumTools } from './curriculum-tools.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL phải được cấu hình.');

const pool = new Pool({
  connectionString: databaseUrl,
  allowExitOnIdle: true,
});

const db = drizzle(pool, { schema });
const curriculum = new CurriculumService(new PostgresCurriculumRepository(db));
const authorization = new AuthorizationService(new PostgresAuthorizationRepository(db), (event) => {
  if (event.capability === 'platform:moderate') {
    console.error(JSON.stringify({ source: 'mcp', ...event }));
  }
});

async function authorizeWrite() {
  const actor = z.uuid().safeParse(process.env.GIAOKHOA_MCP_TRUSTED_ADMIN_USER_ID);
  if (!actor.success) {
    console.error(
      JSON.stringify({
        source: 'mcp',
        action: 'write',
        allowed: false,
        reason: 'missing_trusted_actor',
      }),
    );
    throw new ClientError(
      'forbidden',
      'mcp_trusted_actor_required',
      'MCP chưa cấu hình trusted admin actor',
    );
  }
  await authorization.assertAuthorized({
    actorId: actor.data,
    capability: 'platform:moderate',
    context: { kind: 'system', resourceKey: 'giaokhoa' },
  });
}

void serveStdio(() => {
  const server = new McpServer({
    name: 'giaokhoa',
    version: '0.0.1',
  });

  registerCurriculumTools(server, curriculum, authorizeWrite);
  return server;
});
