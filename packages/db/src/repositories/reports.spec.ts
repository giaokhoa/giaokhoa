import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import type { CentreDb } from '../client';
import { ReportsRepository } from './reports';

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const queries = this.queries;
    return {
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        queries.push(compiledQuery);
        return { rows: [{ ok: 1 } as R] };
      },
      async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {},
    };
  }

  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

function repoOnRecordingDriver(): { repo: ReportsRepository; driver: RecordingDriver } {
  const driver = new RecordingDriver();
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { repo: new ReportsRepository(db as unknown as CentreDb), driver };
}

describe('userHasAnyRole — khuôn sql.join của T-11 ở tầng biên dịch', () => {
  it('danh sách vai trò rỗng: trả false ngay và không phát truy vấn nào (IN () không hợp lệ)', async () => {
    const { repo, driver } = repoOnRecordingDriver();
    await expect(repo.userHasAnyRole('user-1', [])).resolves.toBe(false);
    expect(driver.queries).toHaveLength(0);
  });

  it('một vai trò: biên dịch thành IN ($2) với tham số userId đứng trước tham số vai trò', async () => {
    const { repo, driver } = repoOnRecordingDriver();
    await expect(repo.userHasAnyRole('user-1', ['teacher'])).resolves.toBe(true);
    expect(driver.queries).toHaveLength(1);
    const compiled = driver.queries[0]!;
    expect(compiled.sql).toContain('ra.user_id = $1');
    expect(compiled.sql).toContain('r.short_name in ($2)');
    expect(compiled.parameters).toEqual(['user-1', 'teacher']);
  });

  it('nhiều vai trò: các mảnh nối bằng ", " và tham số giữ đúng thứ tự mảng', async () => {
    const { repo, driver } = repoOnRecordingDriver();
    await expect(repo.userHasAnyRole('user-1', ['teacher', 'manager', 'member'])).resolves.toBe(true);
    const compiled = driver.queries[0]!;
    expect(compiled.sql).toContain('r.short_name in ($2, $3, $4)');
    expect(compiled.parameters).toEqual(['user-1', 'teacher', 'manager', 'member']);
  });

  it('đoạn chứa biểu thức con có tham số riêng: tham số của biểu thức con nằm tại vị trí của đoạn trong danh sách', async () => {
    const driver = new RecordingDriver();
    const db = new Kysely<Record<string, never>>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const userId = 'user-1';
    const fragments = [sql`lower(${'TeAcHeR'})`, sql`${'manager'}`];
    await sql`
      select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
      where ra.user_id = ${userId} and lower(r.short_name) in (${sql.join(fragments, sql`, `)}) limit 1`
      .execute(db);
    expect(driver.queries).toHaveLength(1);
    const compiled = driver.queries[0]!;
    expect(compiled.sql).toContain('in (lower($2), $3)');
    expect(compiled.parameters).toEqual(['user-1', 'TeAcHeR', 'manager']);
  });
});
