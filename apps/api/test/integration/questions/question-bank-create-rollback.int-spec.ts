import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, roleIdByShortname, systemContextId,
} from '../../support/identity-access-helpers';
import { RolesService } from '../../../src/modules/access/roles.service';
import { QuestionBanksService } from '../../../src/modules/questions/question-banks.service';

const TEST_DB_URL = process.env.GIAOKHOA_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/giaokhoa_test_api';

describe('Tạo bank câu hỏi — rollback nguyên tử khi bước gán vai cuối luồng lỗi (issue #490)', () => {
  let app: INestApplication;
  let pg: Client;
  let banks: QuestionBanksService;
  let roles: RolesService;
  let staffId: string;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await pg.query<{ count: string }>(sql, params);
    return Number(rows[0]!.count);
  }

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: TEST_DB_URL });
    await pg.connect();
    banks = app.get(QuestionBanksService);
    roles = app.get(RolesService);
    const admin = await adminToken(app);
    const staff = await createUserViaApi(app, admin);
    staffId = staff.id;
    const systemCtx = await systemContextId(app, admin);
    const teacherRoleId = await roleIdByShortname(app, admin, 'editingteacher');
    await assignRole(app, admin, staffId, teacherRoleId, systemCtx);
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
  });

  it('lỗi ở bước gán vai lead thì không còn bank, category, context, override hay sự kiện nào được ghi', async () => {
    const banksBefore = await count('SELECT count(*) AS count FROM question_banks');
    const categoriesBefore = await count('SELECT count(*) AS count FROM question_categories');
    const contextsBefore = await count('SELECT count(*) AS count FROM context');
    const capsBefore = await count('SELECT count(*) AS count FROM role_capabilities');
    const outboxBefore = await count("SELECT count(*) AS count FROM outbox_events WHERE type = 'question_bank_created'");

    const spy = vi.spyOn(roles, 'assignRole').mockRejectedValue(new Error('rollback probe'));
    try {
      await banks.ensurePersonalBank(staffId).catch(() => undefined);
    } finally {
      spy.mockRestore();
    }

    expect(await count('SELECT count(*) AS count FROM question_banks WHERE owner_id = $1', [staffId])).toBe(0);
    expect(await count('SELECT count(*) AS count FROM question_banks')).toBe(banksBefore);
    expect(await count('SELECT count(*) AS count FROM question_categories')).toBe(categoriesBefore);
    expect(await count('SELECT count(*) AS count FROM context')).toBe(contextsBefore);
    expect(await count('SELECT count(*) AS count FROM role_capabilities')).toBe(capsBefore);
    expect(await count("SELECT count(*) AS count FROM outbox_events WHERE type = 'question_bank_created'")).toBe(outboxBefore);
  });

  it('gọi lại sau lần tạo hỏng thì bank được tạo trọn vẹn: category mặc định, override hai vai, gán lead và sự kiện', async () => {
    const bank = await banks.ensurePersonalBank(staffId);
    expect(bank.scope).toBe('personal');
    expect(bank.ownerId).toBe(staffId);

    expect(await count('SELECT count(*) AS count FROM question_categories WHERE bank_id = $1', [bank.id])).toBe(1);
    expect(await count('SELECT count(*) AS count FROM role_capabilities WHERE context_id = $1', [bank.contextId])).toBeGreaterThan(0);
    expect(await count(
      `SELECT count(*) AS count FROM role_assignments ra
       JOIN role r ON r.id = ra.role_id
       WHERE ra.user_id = $1 AND ra.context_id = $2 AND r.short_name = 'qbanklead'`,
      [staffId, bank.contextId],
    )).toBe(1);
    expect(await count(
      "SELECT count(*) AS count FROM outbox_events WHERE type = 'question_bank_created' AND payload->>'bankId' = $1",
      [bank.id],
    )).toBe(1);
  });
});
