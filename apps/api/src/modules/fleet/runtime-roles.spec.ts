import { describe, expect, it } from 'vitest';
import {
  buildEnsureRoleStatements,
  buildOwnershipTransferQuery,
  buildRoleConnectStatements,
  buildRuntimeGrantStatements,
  buildTransferDatabaseOwnerStatement,
  parseRoleEndpoint,
} from './runtime-roles';

/**
 * Khoá hành vi của helper cấp phát role runtime/migration (issue
 * #586): đích cấp phát chỉ suy ra từ URL, tư thế quyền của hai role
 * luôn ở khuôn tối thiểu (không superuser, runtime không sở hữu đối
 * tượng), và quyền của runtime chỉ là quyền dữ liệu kèm quyền mặc
 * định gắn với role migration — đổi các bất biến này thì test phải
 * đỏ, vì chúng là nền của cô lập kết nối giữa các kho.
 */
describe('Cấp phát role runtime và role migration (helper thuần)', () => {
  it('đọc tên database từ path, role từ username và mật khẩu từ URL', () => {
    const endpoint = parseRoleEndpoint('postgres://giaokhoa_runtime:p%40ss@db.internal:5432/giaokhoa', 'RUNTIME_DATABASE_URL');
    expect(endpoint).toEqual({ database: 'giaokhoa', role: 'giaokhoa_runtime', rolePassword: 'p@ss' });
  });

  it('URL thiếu tên database hoặc thiếu username bị từ chối ngay kèm tên biến cấu hình', () => {
    expect(() => parseRoleEndpoint('postgres://giaokhoa_runtime:pw@db.internal:5432/', 'RUNTIME_DATABASE_URL')).toThrow(
      /RUNTIME_DATABASE_URL must name a database/,
    );
    expect(() => parseRoleEndpoint('postgres://db.internal:5432/giaokhoa', 'MIGRATION_DATABASE_URL')).toThrow(
      /MIGRATION_DATABASE_URL must carry the connection role/,
    );
  });

  it('role chưa tồn tại thì tạo mới, đã tồn tại thì đồng bộ — cả hai đều ở tư thế không superuser, không tạo database/role, không bỏ qua RLS', () => {
    const endpoint = { database: 'giaokhoa', role: 'giaokhoa_migrator', rolePassword: 'pw' };
    const created = buildEnsureRoleStatements(endpoint, false);
    const synced = buildEnsureRoleStatements(endpoint, true);
    expect(created).toEqual([
      `CREATE ROLE "giaokhoa_migrator" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'pw'`,
    ]);
    expect(synced).toEqual([
      `ALTER ROLE "giaokhoa_migrator" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'pw'`,
    ]);
  });

  it('mật khẩu chứa nháy đơn được thoát đúng cú pháp literal SQL', () => {
    const endpoint = { database: 'giaokhoa', role: 'giaokhoa_runtime', rolePassword: "p'w" };
    expect(buildEnsureRoleStatements(endpoint, false)[0]).toContain(`PASSWORD 'p''w'`);
  });

  it('chuyển sở hữu database trỏ về role migration; truy vấn chuyển chủ liệt kê từng lớp đối tượng và loại hẳn các schema hệ thống', () => {
    const endpoint = { database: 'giaokhoa', role: 'giaokhoa_migrator', rolePassword: 'pw' };
    expect(buildTransferDatabaseOwnerStatement(endpoint)).toBe(`ALTER DATABASE "giaokhoa" OWNER TO "giaokhoa_migrator"`);
    const query = buildOwnershipTransferQuery('postgres', 'giaokhoa_migrator');
    // Bốn lớp đối tượng được chuyển: quan hệ (bảng/view/sequence),
    // hàm, kiểu enum/domain và schema.
    expect(query).toContain('ALTER TABLE %I.%I OWNER TO %I');
    expect(query).toContain("c.relkind IN ('r', 'p', 'm', 'v', 'S')");
    expect(query).toContain('ALTER FUNCTION %I.%I(%s) OWNER TO %I');
    expect(query).toContain('ALTER TYPE %I.%I OWNER TO %I');
    expect(query).toContain("t.typtype IN ('e', 'd')");
    expect(query).toContain('ALTER SCHEMA %I OWNER TO %I');
    // Schema hệ thống bị loại ở mọi lớp — đây là lý do không dùng
    // REASSIGN OWNED (superuser gốc sở hữu đối tượng hệ thống bắt
    // buộc trong mọi database nên lệnh đó luôn bị từ chối).
    expect(query).toContain(`ns.nspname NOT IN ('pg_catalog', 'information_schema')`);
    expect(query).toContain(`'postgres'`);
    expect(query).toContain(`'giaokhoa_migrator'`);
  });

  it('sequence gắn với cột của bảng (serial/identity) không được liệt kê riêng — nó đổi chủ theo bảng, liệt kê riêng là lỗi cannot change owner of sequence', () => {
    const query = buildOwnershipTransferQuery('postgres', 'giaokhoa_migrator');
    // Sequence gắn cột: phụ thuộc pg_depend deptype 'a' (serial) hoặc
    // 'i' (identity) vào một cột (refobjsubid <> 0). PostgreSQL từ
    // chối đổi chủ riêng cho sequence dạng này ở cả hai động từ
    // ALTER TABLE và ALTER SEQUENCE; chủ của nó đổi theo bảng chủ.
    expect(query).toContain(`c.relkind = 'S' AND EXISTS`);
    expect(query).toContain(`d.deptype IN ('a', 'i')`);
    expect(query).toContain(`d.refobjsubid <> 0`);
  });

  it('khoá kết nối ở mức cụm: thu hồi PUBLIC rồi chỉ cấp tường minh cho role migration và role runtime', () => {
    expect(buildRoleConnectStatements('giaokhoa', 'giaokhoa_migrator', 'giaokhoa_runtime')).toEqual([
      `REVOKE CONNECT ON DATABASE "giaokhoa" FROM PUBLIC`,
      `GRANT CONNECT ON DATABASE "giaokhoa" TO "giaokhoa_migrator"`,
      `GRANT CONNECT ON DATABASE "giaokhoa" TO "giaokhoa_runtime"`,
    ]);
  });

  it('quyền của runtime chỉ gồm quyền dữ liệu trên bảng/sequence hiện có và quyền mặc định gắn với role migration cho đối tượng tương lai', () => {
    const statements = buildRuntimeGrantStatements('giaokhoa_migrator', 'giaokhoa_runtime');
    expect(statements).toContain(`GRANT USAGE ON SCHEMA public TO "giaokhoa_runtime"`);
    expect(statements).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "giaokhoa_runtime"`);
    expect(statements).toContain(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "giaokhoa_runtime"`);
    expect(statements).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "giaokhoa_migrator" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "giaokhoa_runtime"`,
    );
    expect(statements).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "giaokhoa_migrator" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "giaokhoa_runtime"`,
    );
    expect(statements).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "giaokhoa_migrator" IN SCHEMA public GRANT USAGE ON TYPES TO "giaokhoa_runtime"`,
    );
    // Không câu nào cấp quyền tạo đối tượng hay quyền sở hữu cho runtime.
    for (const statement of statements) {
      expect(statement).not.toMatch(/GRANT CREATE|OWNER TO "giaokhoa_runtime"/);
    }
  });
});
