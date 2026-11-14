import type { InsertObject, UpdateObject } from 'kysely';
import type { CentreDb, CentreDB } from '../client';
import { applyDefined } from './mapping';

export interface PageRow {
  id: string;
  course: string;
  cmId: string | null;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPage {
  id?: string;
  course: string;
  cmId?: string | null;
  name: string;
  content?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ResourceRow {
  id: string;
  course: string;
  cmId: string | null;
  name: string;
  kind: string;
  fileId: string | null;
  url: string | null;
  transcript: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewResource {
  id?: string;
  course: string;
  cmId?: string | null;
  name: string;
  kind?: string;
  fileId?: string | null;
  url?: string | null;
  transcript?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LastAccessRow {
  id: string;
  userId: string;
  courseId: string;
  cmId: string;
  accessedAt: Date;
}

export interface ModuleProgressRow {
  id: string;
  userId: string;
  courseId: string;
  cmId: string;
  percent: number;
  positionSeconds: number | null;
  page: number | null;
  updatedAt: Date;
}

export interface LearningRecordRow {
  id: string;
  userId: string;
  courseId: string;
  cmId: string;
  cmName: string;
  component: string;
  completedAt: Date;
}

export interface NewLearningRecord {
  id?: string;
  userId: string;
  courseId: string;
  cmId: string;
  cmName?: string;
  component?: string;
  completedAt?: Date;
}

const PAGE_COLUMNS = [
  'id',
  'course',
  'cm_id as cmId',
  'name',
  'content',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const RESOURCE_COLUMNS = [
  'id',
  'course',
  'cm_id as cmId',
  'name',
  'kind',
  'file_id as fileId',
  'url',
  'transcript',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const LAST_ACCESS_COLUMNS = [
  'id',
  'user_id as userId',
  'course_id as courseId',
  'cm_id as cmId',
  'accessed_at as accessedAt',
] as const;

const MODULE_PROGRESS_COLUMNS = [
  'id',
  'user_id as userId',
  'course_id as courseId',
  'cm_id as cmId',
  'percent',
  'position_seconds as positionSeconds',
  'page',
  'updated_at as updatedAt',
] as const;

const LEARNING_RECORD_COLUMNS = [
  'id',
  'user_id as userId',
  'course_id as courseId',
  'cm_id as cmId',
  'cm_name as cmName',
  'component',
  'completed_at as completedAt',
] as const;

function pageInsertValues(values: NewPage): InsertObject<CentreDB, 'pages'> {
  const row: InsertObject<CentreDB, 'pages'> = {
    course: values.course,
    name: values.name,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['cmId', 'cm_id'],
    ['content', 'content'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function pageUpdateSet(patch: Partial<NewPage>): UpdateObject<CentreDB, 'pages'> {
  const set: UpdateObject<CentreDB, 'pages'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['course', 'course'],
    ['cmId', 'cm_id'],
    ['name', 'name'],
    ['content', 'content'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function resourceInsertValues(values: NewResource): InsertObject<CentreDB, 'resources'> {
  const row: InsertObject<CentreDB, 'resources'> = {
    course: values.course,
    name: values.name,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['cmId', 'cm_id'],
    ['kind', 'kind'],
    ['fileId', 'file_id'],
    ['url', 'url'],
    ['transcript', 'transcript'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function resourceUpdateSet(patch: Partial<NewResource>): UpdateObject<CentreDB, 'resources'> {
  const set: UpdateObject<CentreDB, 'resources'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['course', 'course'],
    ['cmId', 'cm_id'],
    ['name', 'name'],
    ['kind', 'kind'],
    ['fileId', 'file_id'],
    ['url', 'url'],
    ['transcript', 'transcript'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function learningRecordInsertValues(values: NewLearningRecord): InsertObject<CentreDB, 'learning_records'> {
  const row: InsertObject<CentreDB, 'learning_records'> = {
    user_id: values.userId,
    course_id: values.courseId,
    cm_id: values.cmId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['cmName', 'cm_name'],
    ['component', 'component'],
    ['completedAt', 'completed_at'],
  ]);
  return row;
}

export class ContentRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  get dbHandle(): CentreDb {
    return this.db();
  }

  async insertPage(v: NewPage): Promise<PageRow> {
    const rows = await this.db()
      .insertInto('pages')
      .values(pageInsertValues(v))
      .returning(PAGE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getPage(id: string): Promise<PageRow | undefined> {
    const row = await this.db()
      .selectFrom('pages')
      .select(PAGE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listPages(courseId: string): Promise<PageRow[]> {
    return this.db()
      .selectFrom('pages')
      .select(PAGE_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('id', 'asc')
      .execute();
  }

  async updatePage(id: string, v: Partial<NewPage>): Promise<void> {
    await this.db()
      .updateTable('pages')
      .set({ ...pageUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deletePage(id: string): Promise<void> {
    await this.db().deleteFrom('pages').where('id', '=', id).execute();
  }

  async deletePageByCm(cmId: string): Promise<void> {
    await this.db().deleteFrom('pages').where('cm_id', '=', cmId).execute();
  }

  async insertResource(v: NewResource): Promise<ResourceRow> {
    const rows = await this.db()
      .insertInto('resources')
      .values(resourceInsertValues(v))
      .returning(RESOURCE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getResource(id: string): Promise<ResourceRow | undefined> {
    const row = await this.db()
      .selectFrom('resources')
      .select(RESOURCE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listResources(courseId: string): Promise<ResourceRow[]> {
    return this.db()
      .selectFrom('resources')
      .select(RESOURCE_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('id', 'asc')
      .execute();
  }

  async updateResource(id: string, v: Partial<NewResource>): Promise<void> {
    await this.db()
      .updateTable('resources')
      .set({ ...resourceUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteResource(id: string): Promise<void> {
    await this.db().deleteFrom('resources').where('id', '=', id).execute();
  }

  async deleteResourceByCm(cmId: string): Promise<void> {
    await this.db().deleteFrom('resources').where('cm_id', '=', cmId).execute();
  }

  async upsertLastAccess(userId: string, courseId: string, cmId: string): Promise<LastAccessRow> {
    const rows = await this.db()
      .insertInto('course_last_access')
      .values({ user_id: userId, course_id: courseId, cm_id: cmId, accessed_at: new Date() })
      .onConflict((oc) =>
        oc.columns(['user_id', 'course_id']).doUpdateSet({ cm_id: cmId, accessed_at: new Date() }),
      )
      .returning(LAST_ACCESS_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getLastAccess(userId: string, courseId: string): Promise<LastAccessRow | undefined> {
    const rows = await this.db()
      .selectFrom('course_last_access')
      .select(LAST_ACCESS_COLUMNS)
      .where('user_id', '=', userId)
      .execute();
    return rows.find((r) => r.courseId === courseId);
  }

  async upsertModuleProgress(
    userId: string,
    courseId: string,
    cmId: string,
    patch: { percent?: number; positionSeconds?: number; page?: number },
  ): Promise<ModuleProgressRow> {
    const existing = await this.getModuleProgress(userId, cmId);
    const percent = Math.max(existing?.percent ?? 0, patch.percent ?? 0);
    const positionSeconds = patch.positionSeconds ?? existing?.positionSeconds ?? null;
    const page = patch.page ?? existing?.page ?? null;
    const rows = await this.db()
      .insertInto('course_module_progress')
      .values({
        user_id: userId,
        course_id: courseId,
        cm_id: cmId,
        percent,
        position_seconds: positionSeconds,
        page,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'cm_id']).doUpdateSet({
          percent,
          position_seconds: positionSeconds,
          page,
          updated_at: new Date(),
        }),
      )
      .returning(MODULE_PROGRESS_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getModuleProgress(userId: string, cmId: string): Promise<ModuleProgressRow | undefined> {
    const row = await this.db()
      .selectFrom('course_module_progress')
      .select(MODULE_PROGRESS_COLUMNS)
      .where('cm_id', '=', cmId)
      .executeTakeFirst();
    return row && row.userId === userId ? row : undefined;
  }

  async insertLearningRecord(v: NewLearningRecord): Promise<void> {
    await this.db()
      .insertInto('learning_records')
      .values(learningRecordInsertValues(v))
      .onConflict((oc) => oc.columns(['user_id', 'cm_id']).doNothing())
      .execute();
  }

  async listLearningRecords(courseId: string): Promise<LearningRecordRow[]> {
    return this.db()
      .selectFrom('learning_records')
      .select(LEARNING_RECORD_COLUMNS)
      .where('course_id', '=', courseId)
      .execute();
  }
}
