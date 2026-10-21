import { describe, expect, it } from 'vitest';
import { AuthorizationService } from '../src/authorization/service.js';
import type {
  AuthorizationContext,
  AuthorizationRepository,
  ContextRef,
  ContextWithRoleInput,
  PermissionGrant,
  RoleAssignmentInput,
} from '../src/authorization/repository.js';

const system: AuthorizationContext = {
  id: 'system',
  kind: 'system',
  resourceKey: 'giaokhoa',
  parentId: null,
};
const classOne: AuthorizationContext = {
  id: 'class-one',
  kind: 'class',
  resourceKey: 'C1',
  parentId: system.id,
};
const classTwo: AuthorizationContext = {
  id: 'class-two',
  kind: 'class',
  resourceKey: 'C2',
  parentId: system.id,
};

class FakeAuthorizationRepository implements AuthorizationRepository {
  contexts = [system, classOne, classTwo];
  grants = new Map<string, PermissionGrant[]>();

  async findContext(ref: ContextRef) {
    return this.contexts.find(
      (item) => item.kind === ref.kind && item.resourceKey === ref.resourceKey,
    );
  }

  async findContextById(id: string) {
    return this.contexts.find((item) => item.id === id);
  }

  async findPermissions(actorId: string, capability: string) {
    return this.grants.get(`${actorId}:${capability}`) ?? [];
  }

  async createContextWithRole(_input: ContextWithRoleInput): Promise<AuthorizationContext> {
    throw new Error('Not used in evaluator tests');
  }

  async assignRole(_input: RoleAssignmentInput): Promise<boolean> {
    throw new Error('Not used in evaluator tests');
  }

  async revokeRole(_contextId: string, _userId: string, _roleKey: string): Promise<boolean> {
    throw new Error('Not used in evaluator tests');
  }

  set(actorId: string, capability: string, grants: PermissionGrant[]) {
    this.grants.set(`${actorId}:${capability}`, grants);
  }
}

const request = {
  actorId: 'actor',
  capability: 'class:update',
  context: { kind: 'class' as const, resourceKey: 'C1' },
};

describe('Dịch vụ phân quyền (AuthorizationService)', () => {
  it('mặc định từ chối khi thiếu quyền và ghi nhận sự kiện kiểm tra ổn định', async () => {
    const repository = new FakeAuthorizationRepository();
    const events: unknown[] = [];
    const service = new AuthorizationService(repository, (event) => events.push(event));

    expect(await service.authorize(request)).toEqual({ allowed: false, reason: 'no_grant' });
    expect(events).toEqual([{ ...request, allowed: false, reason: 'no_grant' }]);
    await expect(service.assertAuthorized(request)).rejects.toMatchObject({
      kind: 'forbidden',
      code: 'authorization_denied',
    });
  });

  it('ưu tiên quyền ALLOW ở phạm vi cụ thể nhất và không kế thừa quyền giữa các lớp cùng cấp', async () => {
    const repository = new FakeAuthorizationRepository();
    repository.set('actor', 'class:update', [{ contextId: classOne.id, effect: 'ALLOW' }]);
    const service = new AuthorizationService(repository);

    expect(await service.authorize(request)).toEqual({
      allowed: true,
      reason: 'granted',
      matchedContextId: classOne.id,
    });
    expect(
      await service.authorize({ ...request, context: { kind: 'class', resourceKey: 'C2' } }),
    ).toEqual({ allowed: false, reason: 'no_grant' });
  });

  it('cho phép ALLOW ở phạm vi con ghi đè PREVENT ở phạm vi cha', async () => {
    const repository = new FakeAuthorizationRepository();
    repository.set('actor', 'class:update', [
      { contextId: system.id, effect: 'PREVENT' },
      { contextId: classOne.id, effect: 'ALLOW' },
    ]);

    expect(await new AuthorizationService(repository).authorize(request)).toMatchObject({
      allowed: true,
      reason: 'granted',
      matchedContextId: classOne.id,
    });
  });

  it('ưu tiên PREVENT hơn ALLOW trong cùng phạm vi và bỏ qua INHERIT', async () => {
    const repository = new FakeAuthorizationRepository();
    repository.set('actor', 'class:update', [
      { contextId: classOne.id, effect: 'ALLOW' },
      { contextId: classOne.id, effect: 'INHERIT' },
      { contextId: classOne.id, effect: 'PREVENT' },
    ]);
    expect(await new AuthorizationService(repository).authorize(request)).toEqual({
      allowed: false,
      reason: 'prevented',
      matchedContextId: classOne.id,
    });
  });

  it('áp dụng PROHIBIT tuyệt đối kể cả khi có ALLOW ở phạm vi cụ thể hơn', async () => {
    const repository = new FakeAuthorizationRepository();
    repository.set('actor', 'class:update', [
      { contextId: system.id, effect: 'PROHIBIT' },
      { contextId: classOne.id, effect: 'ALLOW' },
    ]);
    expect(await new AuthorizationService(repository).authorize(request)).toEqual({
      allowed: false,
      reason: 'prohibited',
    });
  });

  it('từ chối phạm vi không xác định, cây cha sai cấu trúc hoặc có chu trình', async () => {
    const repository = new FakeAuthorizationRepository();
    const service = new AuthorizationService(repository);
    expect(
      await service.authorize({ ...request, context: { kind: 'class', resourceKey: 'missing' } }),
    ).toMatchObject({ allowed: false, reason: 'invalid_context' });

    repository.contexts = [system, { ...classOne, parentId: 'class-two' }, classTwo];
    expect(await service.authorize(request)).toMatchObject({
      allowed: false,
      reason: 'invalid_context',
    });

    repository.contexts = [system, { ...classOne, parentId: classOne.id }, classTwo];
    expect(await service.authorize(request)).toMatchObject({
      allowed: false,
      reason: 'invalid_context',
    });
    await expect(service.assertAuthorized(request)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'authorization_context_not_found',
    });
  });
});
