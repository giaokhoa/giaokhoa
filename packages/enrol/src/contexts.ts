import { uuidIdSchema } from '@giaokhoa/contracts';
import { SharedDomainError } from './errors';
import { CONTEXT_COLUMNS, type ContextRow, type EnrolDatabase } from './types';


export const CONTEXT_LEVELS = { SYSTEM: 10, TENANT: 20, USER: 30, COURSECAT: 40, CLASS: 45, COURSE: 50, MODULE: 70, BLOCK: 80 } as const;

export async function getContextById(db: EnrolDatabase, id: string): Promise<ContextRow | undefined> {
  return db.selectFrom('context').select(CONTEXT_COLUMNS).where('id', '=', id).executeTakeFirst();
}

export async function getContextByLevelInstance(
  db: EnrolDatabase,
  contextLevel: number,
  instanceId: string | null,
): Promise<ContextRow | undefined> {
  return db
    .selectFrom('context')
    .select(CONTEXT_COLUMNS)
    .where((eb) => eb.and([
      eb('context.context_level', '=', contextLevel),
      instanceId === null ? eb('context.instance_id', 'is', null) : eb('context.instance_id', '=', instanceId),
    ]))
    .executeTakeFirst();
}

export async function getContextOrThrow(db: EnrolDatabase, id: string): Promise<ContextRow> {
  const row = uuidIdSchema.safeParse(id).success ? await getContextById(db, id) : undefined;
  if (!row) throw new SharedDomainError('access.context_not_found', `Context ${id} not found`);
  return row;
}

export async function getCourseContextId(db: EnrolDatabase, courseId: string): Promise<string> {
  const ctx = await getContextByLevelInstance(db, CONTEXT_LEVELS.COURSE, courseId);
  if (!ctx) throw new SharedDomainError('course.context_missing', `No context for course ${courseId}`);
  return ctx.id;
}

interface NewContext {
  contextLevel: number;
  instanceId: string | null;
  path: string;
  depth: number;
}

async function insertContext(db: EnrolDatabase, values: NewContext): Promise<ContextRow> {
  return db
    .insertInto('context')
    .values({
      context_level: values.contextLevel,
      instance_id: values.instanceId,
      path: values.path,
      depth: values.depth,
    })
    .returning(CONTEXT_COLUMNS)
    .executeTakeFirstOrThrow();
}

async function updateContextPath(db: EnrolDatabase, id: string, path: string, depth: number): Promise<void> {
  await db.updateTable('context').set({ path, depth }).where('id', '=', id).execute();
}

export async function createContext(
  db: EnrolDatabase,
  contextLevel: number,
  instanceId: string,
  parentId?: string,
): Promise<ContextRow> {
  const existing = await getContextByLevelInstance(db, contextLevel, instanceId);
  if (existing) return existing;
  const parent = contextLevel === CONTEXT_LEVELS.SYSTEM
    ? undefined
    : await getContextById(db, parentId ?? (await ensureSystemContext(db)).id);
  if (contextLevel !== CONTEXT_LEVELS.SYSTEM && !parent) {
    throw new SharedDomainError('access.parent_context_not_found', 'Parent context not found');
  }
  const row = await insertContext(db, { contextLevel, instanceId, path: '', depth: 0 });
  const path = parent ? `${parent.path}/${row.id}` : `/${row.id}`;
  const depth = parent ? parent.depth + 1 : 1;
  await updateContextPath(db, row.id, path, depth);
  return { ...row, path, depth };
}

export async function ensureSystemContext(db: EnrolDatabase): Promise<ContextRow> {
  const existing = await getContextByLevelInstance(db, CONTEXT_LEVELS.SYSTEM, null);
  if (existing) return existing;
  const row = await insertContext(db, { contextLevel: CONTEXT_LEVELS.SYSTEM, instanceId: null, path: '', depth: 0 });
  const path = `/${row.id}`;
  await updateContextPath(db, row.id, path, 1);
  return { ...row, path, depth: 1 };
}

export async function ensureTenantContext(db: EnrolDatabase, tenantId: string): Promise<ContextRow> {
  const existing = await getContextByLevelInstance(db, CONTEXT_LEVELS.TENANT, tenantId);
  if (existing) return existing;
  const system = await ensureSystemContext(db);
  return createContext(db, CONTEXT_LEVELS.TENANT, tenantId, system.id);
}

export async function bumpContextVersions(db: EnrolDatabase, pathPrefix: string): Promise<void> {
  await db
    .updateTable('context')
    .set({ version: (eb) => eb('version', '+', 1) })
    .where((eb) => eb.or([
      eb('path', '=', pathPrefix),
      eb('path', 'like', `${pathPrefix}/%`),
    ]))
    .execute();
}

export async function markContextDirty(db: EnrolDatabase, contextId: string): Promise<void> {
  const ctx = await getContextById(db, contextId);
  if (ctx) await bumpContextVersions(db, ctx.path);
}

export async function getContextsByIds(db: EnrolDatabase, ids: string[]): Promise<ContextRow[]> {
  if (ids.length === 0) return [];
  return db.selectFrom('context').select(CONTEXT_COLUMNS).where('id', 'in', ids).execute();
}
