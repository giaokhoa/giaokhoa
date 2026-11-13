
export class SharedDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SharedDomainError';
    this.code = code;
  }
}

export const ROLE_CONTEXT_CONFLICT_CODE = 'access.role_context_conflict';

export class RoleContextConflictError extends SharedDomainError {
  constructor(message: string) {
    super(ROLE_CONTEXT_CONFLICT_CODE, message);
    this.name = 'RoleContextConflictError';
  }
}

export function isRoleContextConflictError(err: unknown): boolean {
  if (err instanceof SharedDomainError) return err.code === ROLE_CONTEXT_CONFLICT_CODE;
  if (err instanceof Error) {
    const shaped = err as { code?: unknown; getResponse?: unknown };
    if (shaped.code === ROLE_CONTEXT_CONFLICT_CODE) return true;
    if (typeof shaped.getResponse === 'function') {
      const response = (shaped.getResponse as () => unknown).call(err) as { code?: unknown } | string;
      return typeof response === 'object' && response !== null && response.code === ROLE_CONTEXT_CONFLICT_CODE;
    }
  }
  return false;
}
