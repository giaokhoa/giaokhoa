import { sql, type RawBuilder } from 'kysely';
import type { CentreDb, CentreTx } from '../client';
import type { JsonValue } from '../types/centre-db';

export type McpIdempotencyDb = CentreDb | CentreTx;

export interface McpIdempotencyKeyRow {
  id: string;
  userId: string;
  key: string;
  tool: string;
  requestHash: string;
  responseJson: unknown;
  createdAt: Date;
  expiresAt: Date;
}

const TTL_MS = 24 * 60 * 60 * 1000;

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

const MCP_IDEMPOTENCY_KEY_COLUMNS = [
  'id',
  'user_id as userId',
  'key',
  'tool',
  'request_hash as requestHash',
  'response_json as responseJson',
  'created_at as createdAt',
  'expires_at as expiresAt',
] as const;

export class McpIdempotencyRepository {
  constructor(private readonly handle: CentreDb) {}

  async find(userId: string, key: string, db: McpIdempotencyDb = this.handle): Promise<McpIdempotencyKeyRow | null> {
    const row = await db
      .selectFrom('mcp_idempotency_keys')
      .select(MCP_IDEMPOTENCY_KEY_COLUMNS)
      .where('user_id', '=', userId)
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await db
        .deleteFrom('mcp_idempotency_keys')
        .where('id', '=', row.id)
        .execute();
      return null;
    }
    return row;
  }

  async store(input: {
    userId: string;
    key: string;
    tool: string;
    requestHash: string;
    response: Record<string, unknown>;
  }, db: McpIdempotencyDb = this.handle): Promise<void> {
    const now = new Date();
    await db
      .insertInto('mcp_idempotency_keys')
      .values({
        user_id: input.userId,
        key: input.key,
        tool: input.tool,
        request_hash: input.requestHash,
        response_json: jsonbValue(input.response),
        created_at: now,
        expires_at: new Date(now.getTime() + TTL_MS),
      })
      .execute();
  }

  async purgeExpired(db: McpIdempotencyDb = this.handle): Promise<void> {
    await db
      .deleteFrom('mcp_idempotency_keys')
      .where('expires_at', '<=', new Date())
      .execute();
  }
}
