export type AuthorizationContextKind =
  | 'system'
  | 'user'
  | 'bank'
  | 'question'
  | 'exam'
  | 'class'
  | 'assignment';

/** Quyền cấm tuyệt đối phủ quyết toàn cây; định nghĩa quyền vai trò và các ghi đè trên cây ngữ cảnh. */
export type PermissionEffect = 'INHERIT' | 'ALLOW' | 'PREVENT' | 'PROHIBIT';

export type AuthorizationContext = {
  id: string;
  kind: AuthorizationContextKind;
  resourceKey: string;
  parentId: string | null;
};

export type PermissionGrant = {
  contextId: string;
  assignmentContextId?: string;
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
  /** Quản trị định nghĩa vai trò theo Moodle, luôn yêu cầu capability cấp hệ thống. */
  createRole(
    actorId: string,
    key: string,
    contextKind: 'system' | 'class',
    levels: AuthorizationContextKind[],
  ): Promise<boolean>;
  setRolePermission(
    actorId: string,
    roleKey: string,
    capability: string,
    effect: PermissionEffect,
  ): Promise<boolean>;
  listRoleContexts(): Promise<
    Array<{
      key: string;
      contextKind: AuthorizationContextKind;
      contexts: AuthorizationContextKind[];
    }>
  >;
  setRoleContexts(
    actorId: string,
    roleKey: string,
    levels: AuthorizationContextKind[],
  ): Promise<boolean>;
  setRoleMatrix(
    actorId: string,
    actorRoleKey: string,
    targetRoleKey: string,
    action: 'assign' | 'override',
    allowed: boolean,
  ): Promise<boolean>;
  /** Kiểm tra ma trận role gán và ma trận role ghi đè trong cây ngữ cảnh. */
  canManageRole(
    actorId: string,
    roleKey: string,
    contextIds: string[],
    action: 'assign' | 'override',
  ): Promise<boolean>;
  /** Ghi đè khả năng của một vai trò chỉ tại ngữ cảnh chỉ định; INHERIT xóa override. */
  setRoleOverride(
    contextId: string,
    roleKey: string,
    capability: string,
    effect: PermissionEffect,
    actorId: string,
  ): Promise<boolean>;
  revokeRole(
    contextId: string,
    userId: string,
    roleKey: string,
    authorizedBy?: string,
  ): Promise<boolean>;
}
