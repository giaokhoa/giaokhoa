import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD } from '../../support/identity-access-helpers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONN = process.env.DATABASE_URL;

describe('Khoá chính UUIDv7 (kiểm chứng platform PostgreSQL 18)', () => {
  let app: INestApplication;
  let admin: string;
  let pg: Client;
  const run = `u7${Date.now().toString(36)}`;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: CONN });
    await pg.connect();
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  it('(1) insert SQL thô không có id nhận id phiên bản 7, và migration baseline duy nhất mặc định mọi PK thành uuidv7()', async () => {
    const cat = await pg.query(
      `insert into course_categories (name, tenant_id) values ($1, (select id from tenants where slug = 'trang-chinh')) returning id, uuid_extract_version(id) as v`,
      [`${run}-cat`],
    );
    expect(cat.rows[0].v).toBe(7);
    const course = await pg.query(
      `insert into course (category, tenant_id, full_name, short_name, is_template) values ($1, (select tenant_id from course_categories where id = $1), $2, $3, true) returning id, uuid_extract_version(id) as v`,
      [cat.rows[0].id, `${run} course`, `${run}c`],
    );
    expect(course.rows[0].v).toBe(7);
    const tag = await pg.query(
      `insert into tag (name, raw_name) values ($1, $1) returning id, uuid_extract_version(id) as v`,
      [`${run}-tag`],
    );
    expect(tag.rows[0].v).toBe(7);
    const outbox = await pg.query(
      `insert into outbox_events (aggregate, type, payload) values ('course', $1, '{}'::jsonb) returning id, uuid_extract_version(id) as v`,
      [`${run}.created`],
    );
    expect(outbox.rows[0].v).toBe(7);

    const migrationsDir = join(process.cwd(), '..', '..', 'packages', 'db', 'migrations', 'centre');
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(migrationsDir, d.name, 'migration.sql'));
    const baselines = migrations.filter((file) => file.includes('20261025163710_baseline'));
    expect(baselines).toHaveLength(1);
    const sqlText = readFileSync(baselines[0]!, 'utf8');
    expect(sqlText.match(/DEFAULT uuidv7\(\)/g)?.length).toBe(187);
    expect(sqlText.match(/GENERATED ALWAYS AS IDENTITY/g)?.length).toBe(2);
    const sequenceNames = [...sqlText.matchAll(/CREATE SEQUENCE "[^"]+"\."([^"]+)"/g)].map((m) => m[1]);
    expect(sequenceNames).toEqual(['payment_code_seq']);
  });

  it('(1b) catalog live mặc định mọi id thực thể thành uuidv7(), và bảng join thuần không mang id thay thế', async () => {
    const defaults = await pg.query<{ table_name: string; column_default: string | null }>(
      `SELECT c.relname AS table_name, pg_get_expr(d.adbin, d.adrelid) AS column_default
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id'
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname NOT IN ('kysely_migration', 'kysely_migration_lock')`,
    );
    const TEXT_ID_ALLOWLIST = ['oauth_client', 'oauth_client_assertion'];
    expect(defaults.rows.length).toBe(191);
    for (const row of defaults.rows) {
      if (TEXT_ID_ALLOWLIST.includes(row.table_name)) {
        if (row.table_name === 'oauth_client') {
          expect(row.column_default, `table ${row.table_name}`).toBe('gen_random_uuid()');
        } else {
          expect(row.column_default, `table ${row.table_name}`).toBeNull();
        }
        continue;
      }
      expect(row.column_default, `table ${row.table_name}`).toBe('uuidv7()');
    }
    expect(
      defaults.rows.filter((row) => TEXT_ID_ALLOWLIST.includes(row.table_name)).map((row) => row.table_name).sort(),
    ).toEqual([...TEXT_ID_ALLOWLIST].sort());
    const joinTables: Record<string, number> = {
      cohort_members: 2,
      groupings_groups: 2,
      message_conversation_members: 2,
      message_contact_requests: 2,
      message_users_blocked: 2,
      course_completion_settings: 1,
      tag_correlation: 1,
    };
    for (const [joinTable, pkColumns] of Object.entries(joinTables)) {
      expect(defaults.rows.map((r) => r.table_name)).not.toContain(joinTable);
      const pk = await pg.query<{ attname: string }>(
        `SELECT a.attname FROM pg_constraint con
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
          WHERE con.contype = 'p' AND con.conrelid = $1::regclass`,
        [joinTable],
      );
      expect(pk.rows.length, `join table ${joinTable} PK shape`).toBe(pkColumns);
    }
  });

  it('(2) id đơn điệu trong một phiên: 2.000 insert tuần tự trên một kết nối sắp xếp theo thứ tự chèn', async () => {
    const inserted: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const r = await pg.query(`insert into tag (name, raw_name) values ($1, $1) returning id`, [`${run}-mono-${i}`]);
      inserted.push(r.rows[0].id as string);
    }
    const sorted = await pg.query(`select id from tag where name like $1 order by id`, [`${run}-mono-%`]);
    expect(sorted.rows.map((r) => r.id as string)).toEqual(inserted);
    await pg.query(`delete from tag where name like $1`, [`${run}-mono-%`]);
  }, 60_000);

  it('(3) trộn mặc định DB và id $defaultFn phía app không bao giờ xung đột, và seq vẫn duy nhất và tăng dần', async () => {
    const ids = new Set<string>();
    const seqs: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const appSide = i % 2 === 0;
      const r = appSide
        ? await pg.query(
            `insert into outbox_events (id, aggregate, type, payload) values ($1, 'mix', $2, '{}'::jsonb) returning id, seq`,
            [uuidv7(), `${run}.mix`],
          )
        : await pg.query(
            `insert into outbox_events (aggregate, type, payload) values ('mix', $1, '{}'::jsonb) returning id, seq`,
            [`${run}.mix`],
          );
      ids.add(r.rows[0].id as string);
      seqs.push(r.rows[0].seq as number);
    }
    expect(ids.size).toBe(60);
    for (const id of ids) expect(id).toMatch(UUID_RE);
    expect(new Set(seqs).size).toBe(60);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    await pg.query(`delete from outbox_events where type = $1`, [`${run}.mix`]);
  });

  it('(3b) sinh hỗn hợp hàng loạt vẫn duy nhất: 100k id từ mặc định DB, giá trị phía app và kết nối song song', async () => {
    await pg.query(`create table if not exists u7_probe (id uuid primary key default uuidv7(), marker text not null)`);
    try {
      await pg.query(`insert into u7_probe (marker) select $1 from generate_series(1, 40000)`, [`${run}-bulk-db`]);
      const appIds = Array.from({ length: 30000 }, () => uuidv7());
      await pg.query(`insert into u7_probe (id, marker) select unnest($1::uuid[]), $2`, [appIds, `${run}-bulk-app`]);
      const clients = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const c = new Client({ connectionString: CONN });
          await c.connect();
          return c;
        }),
      );
      try {
        await Promise.all(
          clients.map((c, idx) =>
            c.query(`insert into u7_probe (marker) select $1 from generate_series(1, 10000)`, [`${run}-bulk-par-${idx}`]),
          ),
        );
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
      const agg = await pg.query<{ total: string; distinct_ids: string }>(
        `select count(*) as total, count(distinct id) as distinct_ids from u7_probe where marker like $1`,
        [`${run}-bulk-%`],
      );
      expect(Number(agg.rows[0].total)).toBe(100000);
      expect(agg.rows[0].distinct_ids).toBe(agg.rows[0].total);
    } finally {
      await pg.query(`drop table if exists u7_probe`);
    }
  }, 60_000);

  it('(4) uuid_extract_timestamp khớp created_at trong ±2s', async () => {
    const r = await pg.query(
      `insert into event_log (event_type, payload) values ($1, '{}'::jsonb)
       returning id, created_at, uuid_extract_timestamp(id) as embedded`,
      [`${run}.probe`],
    );
    const row = r.rows[0] as { created_at: Date; embedded: Date };
    const driftMs = Math.abs(new Date(row.embedded).getTime() - new Date(row.created_at).getTime());
    expect(driftMs).toBeLessThanOrEqual(2000);
    await pg.query(`delete from event_log where event_type = $1`, [`${run}.probe`]);
  });

  it('(5) phân trang keyset trên (created_at, id) không trùng lặp cũng không mất dòng khi insert rơi vào giữa lúc phân trang', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const originalIds: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const ts = new Date(base + Math.floor(i / 5) * 1000);
      const r = await pg.query(
        `insert into event_log (event_type, created_at, payload) values ($1, $2, '{}'::jsonb) returning id`,
        [`${run}.page`, ts],
      );
      originalIds.push(r.rows[0].id as string);
    }
    interface PageRow { id: string; created_at: Date }
    const seen: string[] = [];
    let cursor: { t: Date; id: string } | null = null;
    let pages = 0;
    for (;;) {
      const r: { rows: PageRow[] } = cursor === null
        ? await pg.query(
            `select id, created_at from event_log where event_type = $1 order by created_at, id limit 7`,
            [`${run}.page`],
          )
        : await pg.query(
            `select id, created_at from event_log where event_type = $1 and (created_at, id) > ($2, $3)
             order by created_at, id limit 7`,
            [`${run}.page`, cursor.t, cursor.id],
          );
      if (r.rows.length === 0) break;
      pages += 1;
      for (const row of r.rows) seen.push(row.id);
      const last: PageRow = r.rows[r.rows.length - 1]!;
      cursor = { t: last.created_at, id: last.id };
      if (pages === 2) {
        for (let i = 0; i < 3; i += 1) {
          await pg.query(
            `insert into event_log (event_type, created_at, payload) values ($1, $2, '{}'::jsonb)`,
            [`${run}.page`, new Date(base + 3_600_000 + i)],
          );
        }
      }
      if (pages > 10) throw new Error('pagination did not terminate');
    }
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of originalIds) expect(seen.filter((s) => s === id)).toHaveLength(1);
    await pg.query(`delete from event_log where event_type = $1`, [`${run}.page`]);
  });

  it('(6) bộ lọc FK dùng index FK tường minh (planner + sự hiện diện pg_indexes)', async () => {
    const expectedIndexes = [
      'course_category_idx',
      'course_modules_course_idx',
      'course_modules_section_idx',
      'grade_grades_user_id_idx',
      'user_enrolments_user_id_idx',
    ];
    const present = await pg.query(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)`,
      [expectedIndexes],
    );
    expect(present.rows.map((r) => r.indexname as string).sort()).toEqual([...expectedIndexes].sort());

    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    await pg.query('begin');
    try {
      await pg.query('set local enable_seqscan = off');
      const plan = await pg.query(`explain (format json) select * from course where category = $1`, [course.category]);
      const planText = JSON.stringify(plan.rows[0]['QUERY PLAN']);
      expect(planText).toContain('Index');
      expect(planText).toContain('course_category_idx');
    } finally {
      await pg.query('rollback');
    }
  });

  it('(6b) mọi khoá ngoại một cột trong schema đều được cột index đầu bao phủ', async () => {
    const missing = await pg.query<{ col: string }>(
      `SELECT conrelid::regclass || '.' || a.attname AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum)`,
    );
    expect(missing.rows.map((r) => r.col)).toEqual([]);
  });

  it('(7) IDOR: UUID hợp lệ của tài nguyên khoá khác vẫn bị từ chối (404/403) sau khi đổi khoá', async () => {
    const cat = await createCategory(app, admin);
    const courseA = await createCourse(app, admin, cat.id);
    const courseB = await createCourse(app, admin, cat.id);
    const student = await createUserViaApi(app, admin);
    const instance = await createEnrolInstance(app, admin, courseA.id);
    await enrolUser(app, admin, courseA.id, instance.id, student.id);
    const token = (await login(app, student.username, STRONG_PASSWORD)).accessToken;

    const own = await http(app).get(`/api/v1/courses/${courseA.id}/content`).set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
    const foreign = await http(app).get(`/api/v1/courses/${courseB.id}/content`).set('Authorization', `Bearer ${token}`);
    expect([403, 404]).toContain(foreign.status);
  });

  it('(8) Hợp đồng API: id tuần tự hoá thành chuỗi UUIDv7; id sai định dạng → 400; id đúng định dạng nhưng lạ → 404', async () => {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    expect(typeof course.id).toBe('string');
    expect(course.id).toMatch(UUID_RE);

    const malformed = await http(app).get('/api/v1/courses/not-a-uuid').set('Authorization', `Bearer ${admin}`);
    expect(malformed.status).toBe(400);

    const missing = await http(app).get(`/api/v1/courses/${uuidv7()}`).set('Authorization', `Bearer ${admin}`);
    expect(missing.status).toBe(404);
  });

  it('(8b) id người dùng tuân cùng hợp đồng — và id người dùng sai định dạng là 400, không bao giờ là 500 từ guard năng lực', async () => {
    const created = await createUserViaApi(app, admin);
    expect(created.id).toMatch(UUID_RE);

    const malformed = await http(app).get('/api/v1/users/not-a-uuid').set('Authorization', `Bearer ${admin}`);
    expect(malformed.status).toBe(400);

    const missing = await http(app).get(`/api/v1/users/${uuidv7()}`).set('Authorization', `Bearer ${admin}`);
    expect(missing.status).toBe(404);
  });
});
