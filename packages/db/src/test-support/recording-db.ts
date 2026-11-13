import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import type { CentreDb, CentreDB } from '../client';

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const queries = this.queries;
    return {
      executeQuery: async <R>(compiled: CompiledQuery): Promise<QueryResult<R>> => {
        queries.push(compiled);
        return { rows: [] };
      },
      streamQuery: async function* <R>(): AsyncIterableIterator<QueryResult<R>> {
        yield* [];
      },
    };
  }

  async beginTransaction(): Promise<void> {}

  async commitTransaction(): Promise<void> {}

  async rollbackTransaction(): Promise<void> {}

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

export function createRecordingDb(): { db: CentreDb; driver: RecordingDriver } {
  const driver = new RecordingDriver();
  const db = new Kysely<CentreDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
}
