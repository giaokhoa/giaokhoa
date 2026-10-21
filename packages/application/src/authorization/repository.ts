export type AuthorizationContextKind =
  | 'system'
  | 'user'
  | 'bank'
  | 'question'
  | 'exam'
  | 'class'
  | 'assignment';

/** Quyền cấm tuyệt đối phủ quyết toàn cây; quyền ngăn và quyền cho phép được xét theo phạm vi gần nhất. */
export type PermissionEffect = 'INHERIT' | 'ALLOW' | 'PREVENT' | 'PROHIBIT';

export type AuthorizationContext = {
  id: string;
  kind: AuthorizationContextKind;
  resourceKey: string;
  parentId: string | null;
};

export type PermissionGrant = {
  contextId: string;
  effect: PermissionEffect;
};

export type ContextRef = {
  kind: AuthorizationContextKind;
  resourceKey: string;
};

export type ContextWithRoleInput = {
  context: ContextRef & { parentId: string };
  userId: string;
  roleKey: string;
  source: string;
  grantedByUserId?: string;
};

export type RoleAssignmentInput = {
  contextId: string;
  userId: string;
  roleKey: string;
  source: string;
  grantedByUserId?: string;
};

/** Hợp đồng tra cứu quyền hiện hành và thay đổi vai trò; chỉ xét các lần cấp vai trò chưa bị thu hồi. */
export interface AuthorizationRepository {
  findContext(ref: ContextRef): Promise<AuthorizationContext | undefined>;
  findContextById(id: string): Promise<AuthorizationContext | undefined>;
  findPermissions(
    actorId: string,
    capability: string,
    contextIds: string[],
  ): Promise<PermissionGrant[]>;
  /** Tạo phạm vi và vai trò ban đầu trong cùng giao dịch để tránh tài nguyên thiếu chủ sở hữu. */
  createContextWithRole(input: ContextWithRoleInput): Promise<AuthorizationContext>;
  /** Không tạo hai lần cấp vai trò còn hiệu lực cho cùng người dùng, vai trò và phạm vi. */
  assignRole(input: RoleAssignmentInput): Promise<boolean>;
  revokeRole(
    contextId: string,
    userId: string,
    roleKey: string,
    authorizedBy?: string,
  ): Promise<boolean>;
}
