import { PostgresAuthorizationRepository } from '../src/repositories/authorization.js';
import type { Database } from '../src/types.js';
import type { AuthorizationContextKind } from '@giaokhoa/application/authorization/repository';

/** Cấp quyền thử nghiệm qua cùng cơ chế vai trò/ngữ cảnh với ứng dụng. */
export async function grantRole(
  db: Database,
  userId: string,
  roleKey: string,
  kind: AuthorizationContextKind = 'system',
  resourceKey = 'giaokhoa',
) {
  const repository = new PostgresAuthorizationRepository(db);
  const context = await repository.findContext({ kind, resourceKey });
  if (!context) throw new Error('Thiếu phạm vi phân quyền trong dữ liệu kiểm thử');
  return repository.assignRole({ contextId: context.id, userId, roleKey, source: 'test_fixture' });
}

/** Thu hồi vai trò thử nghiệm trong đúng phạm vi, không sửa hồ sơ Better Auth. */
export async function revokeRole(
  db: Database,
  userId: string,
  roleKey: string,
  kind: AuthorizationContextKind = 'system',
  resourceKey = 'giaokhoa',
) {
  const repository = new PostgresAuthorizationRepository(db);
  const context = await repository.findContext({ kind, resourceKey });
  if (!context) throw new Error('Thiếu phạm vi phân quyền trong dữ liệu kiểm thử');
  return repository.revokeRole(context.id, userId, roleKey);
}

export async function grantSystemRole(db: Database, userId: string, role: 'teacher' | 'admin') {
  return grantRole(db, userId, `system:${role}`);
}
export async function revokeSystemRole(db: Database, userId: string, role: 'teacher' | 'admin') {
  return revokeRole(db, userId, `system:${role}`);
}
