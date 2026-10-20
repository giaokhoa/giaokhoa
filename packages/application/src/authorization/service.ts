import { ClientError } from '../common/client-error.js';
import type {
  AuthorizationContextKind,
  AuthorizationRepository,
  ContextRef,
  PermissionGrant,
} from './repository.js';

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

export class AuthorizationService {
  constructor(
    private readonly repository: AuthorizationRepository,
    private readonly audit?: (event: AuthorizationAuditEvent) => void,
  ) {}

  /**
   * Xét grant từ context cụ thể lên System: PROHIBIT phủ quyết toàn cây,
   * PREVENT thắng ALLOW cùng cấp, thiếu ALLOW thì từ chối.
   * Kết quả capability chưa thay thế kiểm tra owner, enrolment và lifecycle của use case.
   */
  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const context = await this.repository.findContext(request.context);
    if (!context) return this.finish(request, { allowed: false, reason: 'invalid_context' });

    const chain: string[] = [];
    const visited = new Set<string>();
    let current: typeof context | undefined = context;
    while (current) {
      if (visited.has(current.id) || chain.length >= 32)
        return this.finish(request, { allowed: false, reason: 'invalid_context' });
      visited.add(current.id);
      chain.push(current.id);
      if (!current.parentId) {
        if (current.kind !== 'system' || current.resourceKey !== 'giaokhoa')
          return this.finish(request, { allowed: false, reason: 'invalid_context' });
        break;
      }
      const parent = await this.repository.findContextById(current.parentId);
      if (!parent || !validParent(current.kind, parent.kind))
        return this.finish(request, { allowed: false, reason: 'invalid_context' });
      current = parent;
    }

    const grants = await this.repository.findPermissions(
      request.actorId,
      request.capability,
      chain,
    );
    const applicable = grants.filter((grant) => chain.includes(grant.contextId));
    if (applicable.some((grant) => grant.effect === 'PROHIBIT'))
      return this.finish(request, { allowed: false, reason: 'prohibited' });

    for (const contextId of chain) {
      const local = applicable.filter(
        (grant: PermissionGrant) => grant.contextId === contextId && grant.effect !== 'INHERIT',
      );
      if (local.some((grant) => grant.effect === 'PREVENT'))
        return this.finish(request, {
          allowed: false,
          reason: 'prevented',
          matchedContextId: contextId,
        });
      if (local.some((grant) => grant.effect === 'ALLOW'))
        return this.finish(request, {
          allowed: true,
          reason: 'granted',
          matchedContextId: contextId,
        });
    }

    return this.finish(request, { allowed: false, reason: 'no_grant' });
  }

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

  private finish(
    request: AuthorizationRequest,
    decision: AuthorizationDecision,
  ): AuthorizationDecision {
    this.audit?.({ ...request, ...decision });
    return decision;
  }
}
