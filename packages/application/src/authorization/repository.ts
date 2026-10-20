export type AuthorizationContextKind =
  | 'system'
  | 'user'
  | 'bank'
  | 'question'
  | 'exam'
  | 'class'
  | 'assignment';

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

export interface AuthorizationRepository {
  findContext(ref: ContextRef): Promise<AuthorizationContext | undefined>;
  findContextById(id: string): Promise<AuthorizationContext | undefined>;
  findPermissions(
    actorId: string,
    capability: string,
    contextIds: string[],
  ): Promise<PermissionGrant[]>;
  createContextWithRole(input: ContextWithRoleInput): Promise<AuthorizationContext>;
  assignRole(input: RoleAssignmentInput): Promise<boolean>;
  revokeRole(contextId: string, userId: string, roleKey: string): Promise<boolean>;
}
