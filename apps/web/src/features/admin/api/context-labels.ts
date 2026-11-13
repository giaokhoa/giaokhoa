import type { ContextRow } from '#lib/access';

const CONTEXT_LEVEL_LABEL_KEYS: Record<number, string> = {
  10: 'contextLevelSystem',
  20: 'contextLevelTenant',
  30: 'contextLevelUser',
  40: 'contextLevelCourseCategory',
  45: 'contextLevelClass',
  50: 'contextLevelCourse',
  70: 'contextLevelModule',
  80: 'contextLevelBlock',
};

export function contextLevelLabelKey(level: number): string {
  return CONTEXT_LEVEL_LABEL_KEYS[level] ?? 'contextLevelUnknown';
}

export function assignmentContextLabel(
  contexts: ContextRow[],
  assignment: { contextId: string; contextLevel: number },
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  const context = contexts.find((ctx) => ctx.id === assignment.contextId);
  if (context) return contextOptionLabel(contexts, context, translate);
  return translate(contextLevelLabelKey(assignment.contextLevel), {
    level: assignment.contextLevel,
  });
}

export function contextOptionLabel(
  contexts: ContextRow[],
  context: ContextRow,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  const base = translate(contextLevelLabelKey(context.contextLevel), {
    level: context.contextLevel,
  });
  const sameLevel = contexts.filter((ctx) => ctx.contextLevel === context.contextLevel);
  if (sameLevel.length <= 1) return base;
  const ordinal = sameLevel.findIndex((ctx) => ctx.id === context.id);
  if (ordinal <= 0) return base;
  return `${base} ${ordinal + 1}`;
}
