export const CAP_INHERIT = 0;
export const CAP_ALLOW = 1;
export const CAP_PREVENT = -1;
export const CAP_PROHIBIT = -1000;

export interface RoleOverridePoint {
  contextId: string;
  permission: number;
}

export function evaluateSingleRole(pointsLeafToRoot: RoleOverridePoint[]): number {
  let result = CAP_INHERIT;
  for (const point of pointsLeafToRoot) {
    if (point.permission === CAP_PROHIBIT) return CAP_PROHIBIT;
    if (result === CAP_INHERIT && point.permission !== CAP_INHERIT) {
      result = point.permission;
    }
  }
  return result;
}

export function aggregateRoleResults(roleResults: number[]): boolean {
  if (roleResults.some((r) => r === CAP_PROHIBIT)) return false;
  return roleResults.some((r) => r === CAP_ALLOW);
}
