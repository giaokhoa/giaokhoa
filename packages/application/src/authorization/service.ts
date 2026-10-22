import { ClientError } from '../common/client-error.js';
import type {
  AuthorizationContextKind,
  AuthorizationRepository,
  ContextRef,
  PermissionGrant,
} from './repository.js';

/** Giới hạn các quan hệ cha-con hợp lệ để không suy quyền qua cây phạm vi sai cấu trúc. */
function validParent(child: AuthorizationContextKind, parent: AuthorizationContextKind) {
  switch (child) {
    case 'system':
      return false;
    case 'user':
    case 'bank':
    case 'class':
      return parent === 'system';
    case 'question':
    case 'exam':
      return parent === 'bank' || parent === 'system';
    case 'assignment':
      return parent === 'class';
  }
}

export type AuthorizationRequest = {
  actorId: string;
  capability: string;
  context: ContextRef;
};

export type AuthorizationDecision = {
  allowed: boolean;
  reason: 'granted' | 'no_grant' | 'prohibited' | 'prevented' | 'invalid_context';
  matchedContextId?: string;
};

export type AuthorizationAuditEvent = AuthorizationRequest & AuthorizationDecision;

/** Xét quyền trên chuỗi phạm vi hiện tại; mọi nhánh quyết định đều có thể ghi nhận qua hàm kiểm toán. */
export class AuthorizationService {
  constructor(
    private readonly repository: AuthorizationRepository,
    private readonly audit?: (event: AuthorizationAuditEvent) => void,
  ) {}

  /**
   * Mỗi vai trò được xét theo định nghĩa và ghi đè ở ngữ cảnh gần nhất.
   * `PROHIBIT` luôn phủ quyết; chỉ cần một vai trò `ALLOW` để vượt qua `PREVENT` ở vai trò khác.
   * Quyền được cấp không thay thế kiểm tra chủ sở hữu, tình trạng tham gia lớp
   * và các điều kiện thuộc vòng đời nghiệp vụ.
   */
  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    return this.finish(request, await this.evaluate(request));
  }

  private async evaluate(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const context = await this.repository.findContext(request.context);
    if (!context) return { allowed: false, reason: 'invalid_context' };

    const chain: string[] = [];
    const visited = new Set<string>();
    let current: typeof context | undefined = context;
    while (current) {
      if (visited.has(current.id) || chain.length >= 32)
        return { allowed: false, reason: 'invalid_context' };
      visited.add(current.id);
      chain.push(current.id);
      if (!current.parentId) {
        if (current.kind !== 'system' || current.resourceKey !== 'giaokhoa')
          return { allowed: false, reason: 'invalid_context' };
        break;
      }
      const parent = await this.repository.findContextById(current.parentId);
      if (!parent || !validParent(current.kind, parent.kind))
        return { allowed: false, reason: 'invalid_context' };
      current = parent;
    }

    const grants = await this.repository.findPermissions(
      request.actorId,
      request.capability,
      chain,
    );
    const applicable = grants.filter((grant) => chain.includes(grant.contextId));
    if (applicable.some((grant) => grant.effect === 'PROHIBIT'))
      return { allowed: false, reason: 'prohibited' };

    // Moodle: tính quyền từng vai trò (gồm định nghĩa và override), sau đó gộp.
    // Vai trò ALLOW được phép nếu không vai trò nào PROHIBIT; PREVENT chỉ ngăn chính vai trò đó.
    const allowed = applicable.find((grant) => grant.effect === 'ALLOW');
    if (allowed)
      return {
        allowed: true,
        reason: 'granted',
        matchedContextId: allowed.contextId,
      };
    const prevented = applicable.find((grant) => grant.effect === 'PREVENT');
    if (prevented)
      return {
        allowed: false,
        reason: 'prevented',
        matchedContextId: prevented.contextId,
      };

    return { allowed: false, reason: 'no_grant' };
  }

  /** Phân biệt phạm vi không tồn tại với tài khoản không đủ quyền khi chuyển quyết định thành lỗi nghiệp vụ. */
  async assertAuthorized(request: AuthorizationRequest): Promise<void> {
    const decision = await this.authorize(request);
    if (decision.allowed) return;
    if (decision.reason === 'invalid_context')
      throw new ClientError(
        'not_found',
        'authorization_context_not_found',
        'Tài nguyên không tồn tại',
      );
    throw new ClientError(
      'forbidden',
      'authorization_denied',
      'Bạn không có quyền thực hiện thao tác này',
    );
  }

  /**
   * Chỉ tra quyền của chính người yêu cầu; không ghi mục bị ẩn thành cảnh báo truy cập trái quyền.
   * Các thao tác nghiệp vụ vẫn dùng authorize/assertAuthorized để kiểm tra và ghi nhận quyết định.
   */
  async checkCapabilities(actorId: string, context: ContextRef, capabilities: string[]) {
    const found = await this.repository.findContext(context);
    if (!found)
      throw new ClientError(
        'not_found',
        'authorization_context_not_found',
        'Phạm vi không tồn tại',
      );
    const decisions = await Promise.all(
      [...new Set(capabilities)].map(async (capability) => ({
        capability,
        ...(await this.evaluate({ actorId, context, capability })),
      })),
    );
    return {
      contextId: found.id,
      capabilities: decisions.filter((item) => item.allowed).map((item) => item.capability),
    };
  }

  private async assertRoleManager(actorId: string) {
    await this.assertAuthorized({
      actorId,
      capability: 'role:manage',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  }

  async createRole(
    actorId: string,
    key: string,
    contextKind: 'system' | 'class',
    levels: AuthorizationContextKind[],
  ) {
    await this.assertRoleManager(actorId);
    return this.repository.createRole(actorId, key, contextKind, levels);
  }

  async setRolePermission(
    actorId: string,
    roleKey: string,
    capability: string,
    effect: PermissionGrant['effect'],
  ) {
    await this.assertRoleManager(actorId);
    return this.repository.setRolePermission(actorId, roleKey, capability, effect);
  }

  async listRoleContexts(actorId: string) {
    await this.assertRoleManager(actorId);
    return this.repository.listRoleContexts();
  }

  async setRoleContexts(actorId: string, roleKey: string, levels: AuthorizationContextKind[]) {
    await this.assertRoleManager(actorId);
    return this.repository.setRoleContexts(actorId, roleKey, levels);
  }

  async setRoleMatrix(
    actorId: string,
    actorRoleKey: string,
    targetRoleKey: string,
    action: 'assign' | 'override',
    allowed: boolean,
  ) {
    await this.assertRoleManager(actorId);
    return this.repository.setRoleMatrix(actorId, actorRoleKey, targetRoleKey, action, allowed);
  }

  /** Vai trò gán theo phạm vi, được kiểm tra cả capability lẫn ma trận cho phép gán. */
  async changeRole(
    actorId: string,
    contextId: string,
    targetUserId: string,
    roleKey: string,
    grant: boolean,
  ) {
    const context = await this.repository.findContextById(contextId);
    if (!context)
      throw new ClientError(
        'not_found',
        'authorization_context_not_found',
        'Phạm vi không tồn tại',
      );
    await this.assertAuthorized({
      actorId,
      capability: context.kind === 'system' ? 'role:assign_system' : 'role:assign',
      context,
    });
    return grant
      ? this.repository.assignRole({
          contextId,
          userId: targetUserId,
          roleKey,
          source: 'context_delegation',
          grantedByUserId: actorId,
        })
      : this.repository.revokeRole(contextId, targetUserId, roleKey, actorId);
  }

  /** Ghi đè định nghĩa của một vai trò trong context; không sửa quyền mặc định toàn cục. */
  async overrideRole(
    actorId: string,
    contextId: string,
    roleKey: string,
    capability: string,
    effect: PermissionGrant['effect'],
  ) {
    const context = await this.repository.findContextById(contextId);
    if (!context || context.kind === 'system')
      throw new ClientError(
        'invalid',
        'authorization_override_context_invalid',
        'Chỉ ghi đè dưới phạm vi hệ thống',
      );
    await this.assertAuthorized({ actorId, capability: 'role:override', context });
    return this.repository.setRoleOverride(contextId, roleKey, capability, effect, actorId);
  }

  /** Chỉ chủ thể có quyền quản lý vai trò hệ thống mới được cấp hoặc thu hồi vai trò này. */
  async changeSystemRole(
    actorId: string,
    targetUserId: string,
    role: 'teacher' | 'admin',
    grant: boolean,
  ) {
    const context = { kind: 'system' as const, resourceKey: 'giaokhoa' };
    await this.assertAuthorized({ actorId, capability: 'role:assign_system', context });
    const system = await this.repository.findContext(context);
    if (!system)
      throw new ClientError(
        'not_found',
        'authorization_context_not_found',
        'Phạm vi hệ thống không tồn tại',
      );
    return grant
      ? this.repository.assignRole({
          contextId: system.id,
          userId: targetUserId,
          roleKey: `system:${role}`,
          source: 'system_administrator',
          grantedByUserId: actorId,
        })
      : this.repository.revokeRole(system.id, targetUserId, `system:${role}`, actorId);
  }

  private finish(
    request: AuthorizationRequest,
    decision: AuthorizationDecision,
  ): AuthorizationDecision {
    this.audit?.({ ...request, ...decision });
    return decision;
  }
}
