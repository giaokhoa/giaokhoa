import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

export function listMigrationNames(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        return statSync(join(migrationsDir, name, 'migration.sql')).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

export function splitMigrationSql(content: string): string[] {
  return content
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export class FrozenSqlProvider implements MigrationProvider {
  constructor(private readonly migrationsDir: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    for (const name of listMigrationNames(this.migrationsDir)) {
      const filePath = join(this.migrationsDir, name, 'migration.sql');
      const statements = splitMigrationSql(readFileSync(filePath, 'utf8'));
      migrations[name] = {
        up: async (db) => {
          for (const statement of statements) {
            await sql.raw(statement).execute(db);
          }
        },
        down: async () => {
          throw new Error(
            `Migration ${name} không có down(): quay lui bằng khôi phục bản sao lưu tiền-migration, không chế tác SQL DROP ngược.`,
          );
        },
      };
    }
    return migrations;
  }
}
