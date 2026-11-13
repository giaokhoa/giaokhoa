import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { RolesService } from '../../../src/modules/access/roles.service';
import {
  adminToken, createContextViaApi, createTestApp, roleIdByShortname, systemContextId,
} from '../../support/identity-access-helpers';

describe('Access: seed cắt bỏ các định nghĩa năng lực đã cũ (issue #35)', () => {
  let app: INestApplication;
  let pg: Client;

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  it('seed lại cơ sở dữ liệu nhiễm tên tiền tố cũ sẽ xoá sạch chúng ở mọi nơi', async () => {
    const admin = await adminToken(app);
    const systemId = await systemContextId(app, admin);
    const managerId = await roleIdByShortname(app, admin, 'manager');
    const catId = (await createContextViaApi(app, admin, 40, uuidv7(), systemId)).id;

    const staleCourse = 'moodle/' + 'course:update';
    const staleQuiz = 'mod/' + 'quiz:attempt';
    const staleCompletion = 'giaokhoa/' + 'completion:manage';
    await pg.query(
      `insert into capabilities (name, cap_type, context_level, component) values
         ($1, 'write', 50, 'core_course'),
         ($2, 'write', 70, 'mod_quiz'),
         ($3, 'write', 50, 'core_completion')
       on conflict (name) do nothing`,
      [staleCourse, staleQuiz, staleCompletion],
    );
    await pg.query(
      `insert into role_capabilities (context_id, role_id, capability, permission) values
         ($1, $2, $4, 1),
         ($3, $2, $5, 1),
         ($1, $2, $6, 1)`,
      [systemId, managerId, catId, staleCourse, staleQuiz, staleCompletion],
    );
    const before = await pg.query<{ n: string }>(
      `select count(*) as n from role_capabilities where capability like '%/%'`,
    );
    expect(Number(before.rows[0].n)).toBe(3);

    await app.get(RolesService).seedDefaults();

    const staleDefs = await pg.query<{ n: string }>(
      `select count(*) as n from capabilities where name like '%/%'`,
    );
    expect(Number(staleDefs.rows[0].n)).toBe(0);
    const staleOverrides = await pg.query<{ n: string }>(
      `select count(*) as n from role_capabilities where capability like '%/%'`,
    );
    expect(Number(staleOverrides.rows[0].n)).toBe(0);

    const defs = await pg.query<{ n: string }>(`select count(*) as n from capabilities`);
    expect(Number(defs.rows[0].n)).toBe(125);
    const renamed = await pg.query<{ permission: number }>(
      `select permission from role_capabilities where context_id = $1 and role_id = $2 and capability = 'course:update'`,
      [systemId, managerId],
    );
    expect(renamed.rows).toHaveLength(1);
    expect(renamed.rows[0].permission).toBe(1);
  });
});
