import { describe, expect, it } from 'vitest';
import { createContext, ensureSystemContext, ensureTenantContext } from './contexts';
import { SharedDomainError } from './errors';
import { FakeEnrolDb } from './test-support/fake-db';

/**
 * Ghim tính idempotent của các hàm đảm bảo context (`contexts.ts`),
 * kể cả khi hai phía cùng tạo đồng thời (C-E5): chèn trùng khoá tự
 * nhiên (level, instance) được xử lý bằng `onConflict doNothing` +
 * đọc lại dòng hiện hữu, không ném unique violation — đúng mẫu
 * `insertAssignment` ở `role-assignment.ts`, dựa trên ràng buộc duy
 * nhất `context_level_instance_unique` trong migration baseline.
 */

const TENANT_ID = '9a7b4d2e-5f36-4a1e-b28c-3d5e7f90a1b2';
const COURSE_ID = 'd5b9e43f-0a6f-5e7d-b084-3c2d4e5f6a7b';
const SYS_CTX_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_CTX_ID = '22222222-2222-4222-8222-222222222222';

/** Một dòng context (khoá snake_case như database). */
function contextRow(id: string, contextLevel: number, instanceId: string | null, path: string, depth: number): Record<string, unknown> {
  return { id, context_level: contextLevel, instance_id: instanceId, path, depth, locked: false, version: 1 };
}

describe('createContext — tạo context con idempotent theo khoá tự nhiên', () => {
  it('chưa có context: chèn mới rồi tính path/depth từ context cha', async () => {
    const db = new FakeEnrolDb();
    db.seed('context', [
      contextRow(SYS_CTX_ID, 10, null, `/${SYS_CTX_ID}`, 1),
      contextRow(TENANT_CTX_ID, 20, TENANT_ID, `/${SYS_CTX_ID}/${TENANT_CTX_ID}`, 2),
    ]);

    const row = await createContext(db.handle, 50, COURSE_ID, TENANT_CTX_ID);

    expect(row.contextLevel).toBe(50);
    expect(row.instanceId).toBe(COURSE_ID);
    expect(row.path).toBe(`/${SYS_CTX_ID}/${TENANT_CTX_ID}/${row.id}`);
    expect(row.depth).toBe(3);
    expect(db.rows('context')).toHaveLength(3);
  });

  it('đã có context cùng khoá tự nhiên: trả nguyên dòng hiện hữu, không chèn thêm', async () => {
    const db = new FakeEnrolDb();
    db.seed('context', [
      contextRow(SYS_CTX_ID, 10, null, `/${SYS_CTX_ID}`, 1),
      contextRow(TENANT_CTX_ID, 20, TENANT_ID, `/${SYS_CTX_ID}/${TENANT_CTX_ID}`, 2),
    ]);

    const row = await createContext(db.handle, 20, TENANT_ID, SYS_CTX_ID);

    expect(row.id).toBe(TENANT_CTX_ID);
    expect(db.log.filter((entry) => entry.kind === 'insert')).toHaveLength(0);
  });

  it('hai phía cùng tạo đồng thời: phía thua đọc lại dòng phía thắng đã chèn, không ném lỗi và chỉ có một dòng', async () => {
    const winner = contextRow('66666666-6666-4666-8666-666666666666', 50, COURSE_ID, `/${SYS_CTX_ID}/${TENANT_CTX_ID}/66666666-6666-4666-8666-666666666666`, 3);
    let planted = false;
    const db = new FakeEnrolDb({
      beforeInsert: (fake, table, values) => {
        // Mô phỏng phía ghi đồng thời: chèn dòng thắng ngay trước lần chèn thật.
        if (table === 'context' && !planted && values.instance_id === COURSE_ID) {
          planted = true;
          fake.seed('context', [winner]);
        }
      },
    });
    db.seed('context', [
      contextRow(SYS_CTX_ID, 10, null, `/${SYS_CTX_ID}`, 1),
      contextRow(TENANT_CTX_ID, 20, TENANT_ID, `/${SYS_CTX_ID}/${TENANT_CTX_ID}`, 2),
    ]);

    const row = await createContext(db.handle, 50, COURSE_ID, TENANT_CTX_ID);

    expect(row.id).toBe(winner.id);
    expect(row.path).toBe(winner.path);
    expect(db.rows('context').filter((r) => r.instance_id === COURSE_ID)).toHaveLength(1);
  });

  it('context cha không tồn tại: ném lỗi parent_context_not_found, không chèn gì', async () => {
    const db = new FakeEnrolDb();
    db.seed('context', [contextRow(SYS_CTX_ID, 10, null, `/${SYS_CTX_ID}`, 1)]);

    let caught: unknown;
    try {
      await createContext(db.handle, 50, COURSE_ID, '77777777-7777-4777-8777-777777777777');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SharedDomainError);
    expect((caught as SharedDomainError).code).toBe('access.parent_context_not_found');
    expect(db.rows('context')).toHaveLength(1);
  });
});

describe('ensureSystemContext — context hệ thống tạo lười', () => {
  it('chưa có context hệ thống: chèn mới làm gốc path với depth 1', async () => {
    const db = new FakeEnrolDb();

    const row = await ensureSystemContext(db.handle);

    expect(row.contextLevel).toBe(10);
    expect(row.instanceId).toBeNull();
    expect(row.path).toBe(`/${row.id}`);
    expect(row.depth).toBe(1);
  });

  it('đã có context hệ thống: trả nguyên dòng hiện hữu, không chèn thêm', async () => {
    const db = new FakeEnrolDb();
    db.seed('context', [contextRow(SYS_CTX_ID, 10, null, `/${SYS_CTX_ID}`, 1)]);

    const row = await ensureSystemContext(db.handle);

    expect(row.id).toBe(SYS_CTX_ID);
    expect(db.log.filter((entry) => entry.kind === 'insert')).toHaveLength(0);
  });
});

describe('ensureTenantContext — context tenant duy nhất của một tenant', () => {
  it('chưa có gì: tạo cả context hệ thống lẫn context tenant dưới nó', async () => {
    const db = new FakeEnrolDb();

    const row = await ensureTenantContext(db.handle, TENANT_ID);

    expect(row.contextLevel).toBe(20);
    expect(row.instanceId).toBe(TENANT_ID);
    expect(row.depth).toBe(2);
    expect(db.rows('context')).toHaveLength(2);
    const system = db.rows('context').find((r) => r.context_level === 10);
    expect(row.path).toBe(`${system!.path as string}/${row.id}`);
  });

  it('đã có context tenant: trả nguyên dòng hiện hữu', async () => {
    const db = new FakeEnrolDb();
    db.seed('context', [
      contextRow(SYS_CTX_ID, 10, null, `/${SYS_CTX_ID}`, 1),
      contextRow(TENANT_CTX_ID, 20, TENANT_ID, `/${SYS_CTX_ID}/${TENANT_CTX_ID}`, 2),
    ]);

    const row = await ensureTenantContext(db.handle, TENANT_ID);

    expect(row.id).toBe(TENANT_CTX_ID);
    expect(db.log.filter((entry) => entry.kind === 'insert')).toHaveLength(0);
  });
});
