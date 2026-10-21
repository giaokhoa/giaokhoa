import { config } from 'dotenv';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authzContexts, authzRoleAssignments, authzRoles, users } from '../dist/schema/index.js';

// Chỉ dùng khi chưa có quản trị viên. Người vận hành phải có quyền kết nối PostgreSQL.
config({ path: new URL('../../../apps/api/.env', import.meta.url).pathname });
const email = process.argv[2];
if (!email || !email.includes('@') || !process.env.DATABASE_URL) {
  console.error('Cách dùng: pnpm --filter @giaokhoa/database authz:bootstrap <email-da-xac-minh>');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await drizzle(pool).transaction(async (tx) => {
      const [system] = await tx
        .select({ id: authzContexts.id })
        .from(authzContexts)
        .where(and(eq(authzContexts.kind, 'system'), eq(authzContexts.resourceKey, 'giaokhoa')));
      const [role] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, 'system:admin'));
      if (!system || !role)
        throw new Error('Phải chạy bản di trú phân quyền trước khi khởi tạo quản trị viên.');
      const existing = await tx
        .select({ id: authzRoleAssignments.id })
        .from(authzRoleAssignments)
        .where(
          and(
            eq(authzRoleAssignments.contextId, system.id),
            eq(authzRoleAssignments.roleId, role.id),
            isNull(authzRoleAssignments.revokedAt),
          ),
        )
        .limit(1);
      if (existing.length)
        throw new Error('Đã có quản trị viên; hãy dùng API cấp vai trò, không khởi tạo lại.');
      const [account] = await tx
        .select({ id: users.id, verified: users.emailVerified, banned: users.banned })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!account?.verified || account.banned)
        throw new Error('Không tìm thấy tài khoản đã xác minh email và đang hoạt động.');
      await tx.insert(authzRoleAssignments).values({
        userId: account.id,
        roleId: role.id,
        contextId: system.id,
        source: 'system_bootstrap',
      });
      console.log('Đã cấp vai trò quản trị hệ thống cho tài khoản đã xác minh.');
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Không thể khởi tạo quản trị viên.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
