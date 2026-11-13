import { sql as kyselySql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCentreKysely, type CentreDb } from '../client';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '../test-support/build-test-database';
import { ReportsRepository } from './reports';

const adminUrl =
  process.env.GIAOKHOA_DB_TEST_ADMIN_URL ??
  (process.env.DATABASE_URL ? withDatabase(process.env.DATABASE_URL, 'postgres') : undefined);

const TEST_DB = 'giaokhoa_db_g648_reports';

const ROLE_TEACHER = '00000000-0000-4000-8000-0000000000a1';
const ROLE_MANAGER = '00000000-0000-4000-8000-0000000000a2';
const ROLE_MEMBER = '00000000-0000-4000-8000-0000000000a3';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const USER_B = '00000000-0000-4000-8000-0000000000b2';
const USER_C = '00000000-0000-4000-8000-0000000000b3';
const CONTEXT_ID = '00000000-0000-4000-8000-0000000000c1';

let pool: Pool;
let db: CentreDb;
let repo: ReportsRepository;

async function oracleUserHasAnyRole(userId: string, roleNames: string[]): Promise<boolean> {
  const placeholders = roleNames.map((_, i) => `$${i + 2}`).join(', ');
  const res = await pool.query(
    `select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
     where ra.user_id = $1 and r.short_name in (${placeholders}) limit 1`,
    [userId, ...roleNames],
  );
  return res.rows.length > 0;
}

beforeAll(async () => {
  if (!adminUrl) throw new Error('Thiếu kết nối quản trị: đặt GIAOKHOA_DB_TEST_ADMIN_URL hoặc DATABASE_URL.');
  const url = await buildTestDatabase({ adminUrl, database: TEST_DB, store: 'centre' });
  pool = new Pool({ connectionString: url });
  db = createCentreKysely(pool);
  repo = new ReportsRepository(db);

  await db.insertInto('context').values({ id: CONTEXT_ID, context_level: 10, depth: 1, path: '/1' }).execute();
  await db.insertInto('role').values([
    { id: ROLE_TEACHER, short_name: 'teacher' },
    { id: ROLE_MANAGER, short_name: 'manager' },
    { id: ROLE_MEMBER, short_name: 'member' },
  ]).execute();
  await db.insertInto('role_assignments').values([
    { role_id: ROLE_TEACHER, user_id: USER_A, context_id: CONTEXT_ID },
    { role_id: ROLE_MANAGER, user_id: USER_B, context_id: CONTEXT_ID },
    { role_id: ROLE_MEMBER, user_id: USER_B, context_id: CONTEXT_ID },
  ]).execute();
});

afterAll(async () => {
  await pool.end();
  if (adminUrl) await dropTestDatabase(adminUrl, TEST_DB);
});

describe('T-11: userHasAnyRole (Kysely) đặt cạnh nguyên văn SQL của đường cũ trên database thật', () => {
  it('một đoạn: kết quả hai phía bằng nhau cho ca khớp và ca không khớp', async () => {
    await expect(repo.userHasAnyRole(USER_A, ['teacher'])).resolves.toBe(true);
    await expect(oracleUserHasAnyRole(USER_A, ['teacher'])).resolves.toBe(true);
    await expect(repo.userHasAnyRole(USER_A, ['manager'])).resolves.toBe(false);
    await expect(oracleUserHasAnyRole(USER_A, ['manager'])).resolves.toBe(false);
    await expect(repo.userHasAnyRole(USER_C, ['teacher'])).resolves.toBe(false);
    await expect(oracleUserHasAnyRole(USER_C, ['teacher'])).resolves.toBe(false);
  });

  it('nhiều đoạn: khớp ở vị trí đoạn thứ hai vẫn tìm thấy, và hai phía luôn cho cùng kết quả', async () => {
    const cases: Array<[string, string[], boolean]> = [
      [USER_B, ['teacher', 'manager'], true],
      [USER_A, ['manager', 'teacher'], true],
      [USER_B, ['admin', 'teacher'], false],
      [USER_C, ['teacher', 'manager', 'member'], false],
    ];
    for (const [userId, names, expected] of cases) {
      await expect(repo.userHasAnyRole(userId, names)).resolves.toBe(expected);
      await expect(oracleUserHasAnyRole(userId, names)).resolves.toBe(expected);
    }
  });

  it('thứ tự tham số đã biên dịch đúng khuôn: tham số ngoài trước, rồi từng đoạn theo thứ tự mảng', () => {
    const roleNames = ['teacher', 'manager', 'member'];
    const kyselyQuery = kyselySql`
      select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
      where ra.user_id = ${USER_A} and r.short_name in (${kyselySql.join(roleNames.map((n) => kyselySql`${n}`), kyselySql`, `)}) limit 1`
      .compile(db);
    expect(kyselyQuery.parameters).toEqual([USER_A, 'teacher', 'manager', 'member']);
    expect(kyselyQuery.sql).toContain('in ($2, $3, $4)');
  });

  it('đoạn chứa biểu thức con có tham số riêng: tham số của biểu thức con giữ vị trí của đoạn, kết quả thật của hai phía bằng nhau', async () => {
    const kyselyFragments = [kyselySql`lower(${'TeAcHeR'})`, kyselySql`${'manager'}`];
    const kyselyQuery = kyselySql<{ ok: number }>`
      select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
      where ra.user_id = ${USER_B} and lower(r.short_name) in (${kyselySql.join(kyselyFragments, kyselySql`, `)}) limit 1`
      .compile(db);
    expect(kyselyQuery.parameters).toEqual([USER_B, 'TeAcHeR', 'manager']);
    const kyselyResult = await kyselySql<{ ok: number }>`
      select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
      where ra.user_id = ${USER_B} and lower(r.short_name) in (${kyselySql.join(kyselyFragments, kyselySql`, `)}) limit 1`
      .execute(db);
    const oracleResult = await pool.query(
      `select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
       where ra.user_id = $1 and lower(r.short_name) in (lower($2), $3) limit 1`,
      [USER_B, 'TeAcHeR', 'manager'],
    );
    expect(kyselyResult.rows.length).toBe(1);
    expect(oracleResult.rows.length).toBe(1);
  });

  it('0 đoạn: câu không chốt chặn thành IN () bị PostgreSQL từ chối; repository trả false ngay', async () => {
    await expect(
      pool.query(
        `select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
         where ra.user_id = $1 and r.short_name in () limit 1`,
        [USER_A],
      ),
    ).rejects.toThrow();
    await expect(oracleUserHasAnyRole(USER_A, [])).rejects.toThrow();
    await expect(repo.userHasAnyRole(USER_A, [])).resolves.toBe(false);
  });
});
