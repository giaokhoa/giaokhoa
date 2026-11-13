import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, uniqueName } from '../../support/identity-access-helpers';
import { RolesService } from '../../../src/modules/access/roles.service';
import { CONTEXT_LEVELS } from '../../../src/modules/access/domain/capabilities';
import { ClassesService } from '../../../src/modules/classes/classes.service';

const TEST_DB_URL = process.env.GIAOKHOA_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/giaokhoa_test_api';

describe('Tạo lớp — rollback nguyên tử khi một bước ghi giữa luồng lỗi (issue #490)', () => {
  let app: INestApplication;
  let pg: Client;
  let classes: ClassesService;
  let roles: RolesService;
  let adminId: string;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await pg.query<{ count: string }>(sql, params);
    return Number(rows[0]!.count);
  }

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: TEST_DB_URL });
    await pg.connect();
    classes = app.get(ClassesService);
    roles = app.get(RolesService);
    const { rows } = await pg.query<{ id: string }>("SELECT id FROM users WHERE username = 'admin'");
    adminId = rows[0]!.id;
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
  });

  it('lỗi ở bước gán vai chủ lớp thì không còn lớp, cohort, context, override hay sự kiện nào được ghi', async () => {
    const name = uniqueName('cls-rollback');
    const contextsBefore = await count('SELECT count(*) AS count FROM context WHERE context_level = $1', [CONTEXT_LEVELS.CLASS]);
    const capsBefore = await count('SELECT count(*) AS count FROM role_capabilities');
    const outboxBefore = await count("SELECT count(*) AS count FROM outbox_events WHERE type = 'class_created'");

    const spy = vi.spyOn(roles, 'assignRole').mockRejectedValue(new Error('rollback probe'));
    try {
      await expect(classes.createClass(adminId, { name })).rejects.toThrow('rollback probe');
    } finally {
      spy.mockRestore();
    }

    expect(await count('SELECT count(*) AS count FROM classes WHERE name = $1', [name])).toBe(0);
    expect(await count("SELECT count(*) AS count FROM cohort WHERE name = $1 AND component = 'class'", [name])).toBe(0);
    expect(await count('SELECT count(*) AS count FROM context WHERE context_level = $1', [CONTEXT_LEVELS.CLASS])).toBe(contextsBefore);
    expect(await count('SELECT count(*) AS count FROM role_capabilities')).toBe(capsBefore);
    expect(await count("SELECT count(*) AS count FROM outbox_events WHERE type = 'class_created'")).toBe(outboxBefore);
  });

  it('tạo lớp thành công giữ nguyên trạng thái cuối: lớp, cohort neo context lớp, override, gán vai chủ lớp và sự kiện', async () => {
    const name = uniqueName('cls-ok');
    const view = await classes.createClass(adminId, { name });

    expect(await count('SELECT count(*) AS count FROM classes WHERE id = $1 AND name = $2', [view.id, name])).toBe(1);
    const ctx = await pg.query<{ id: string }>(
      'SELECT id FROM context WHERE context_level = $1 AND instance_id = $2',
      [CONTEXT_LEVELS.CLASS, view.id],
    );
    expect(ctx.rows).toHaveLength(1);
    const contextId = ctx.rows[0]!.id;
    expect(await count('SELECT count(*) AS count FROM cohort WHERE id = $1 AND context_id = $2', [view.cohortId, contextId])).toBe(1);
    expect(await count('SELECT count(*) AS count FROM role_capabilities WHERE context_id = $1', [contextId])).toBeGreaterThan(0);
    expect(await count(
      `SELECT count(*) AS count FROM role_assignments ra
       JOIN role r ON r.id = ra.role_id
       WHERE ra.user_id = $1 AND ra.context_id = $2 AND r.short_name = 'editingteacher'`,
      [adminId, contextId],
    )).toBe(1);
    expect(await count(
      "SELECT count(*) AS count FROM outbox_events WHERE type = 'class_created' AND payload->>'classId' = $1",
      [view.id],
    )).toBe(1);
  });
});
