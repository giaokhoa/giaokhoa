export const systemCapabilities = [
  'class:join',
  'class:create',
  'question:create_own',
  'question:manage_own',
  'exam:create_own',
  'exam:manage_own',
  'platform:moderate',
  'role:manage',
  'role:assign_system',
];
export const classCapabilities = [
  'class:view',
  'class:update',
  'class:enrolment_manage',
  'assignment:create',
  'assignment:publish',
  'assignment:grade',
  'assignment:view_assigned',
  'assignment:attempt',
  'result:view_own',
  'role:assign',
  'role:override',
];
export const assignmentCapabilities = [
  'assignment:create',
  'assignment:publish',
  'assignment:grade',
  'assignment:view_assigned',
  'assignment:attempt',
  'result:view_own',
];

/** Điều hướng dựa trên quyền hiệu lực từ API, không suy quyền từ tên vai trò hay Better Auth. */
export function workspacePermissions(
  capabilities: readonly string[],
  classes: ReadonlyArray<{ capabilities: readonly string[] }>,
  assignments: ReadonlyArray<{ capabilities: readonly string[] }> = [],
) {
  const has = (key: string) => capabilities.includes(key);
  const scoped = (key: string) =>
    [...classes, ...assignments].some((item) => item.capabilities.includes(key));
  return {
    createQuestion: has('question:create_own'),
    questions: has('question:manage_own'),
    exams: has('exam:manage_own') || has('exam:create_own'),
    classes: has('class:create') || has('class:join') || classes.length > 0,
    assignments:
      has('class:join') ||
      scoped('assignment:create') ||
      scoped('assignment:publish') ||
      scoped('assignment:grade') ||
      scoped('assignment:view_assigned'),
    attempts: has('class:join') || scoped('assignment:attempt') || scoped('result:view_own'),
    curriculum: has('platform:moderate'),
    authorization: has('role:manage') || has('role:assign_system'),
  };
}
