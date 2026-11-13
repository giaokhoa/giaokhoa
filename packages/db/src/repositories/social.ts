import type { Insertable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

type RepoDb = CentreDb | CentreTx;

export interface TagCollectionRow {
  id: string;
  name: string;
  isStandard: boolean;
  component: string | null;
  searchable: boolean;
  customUrl: string | null;
}

export interface TagRow {
  id: string;
  userId: string | null;
  tagCollId: string | null;
  name: string;
  rawName: string;
  isStandard: boolean;
  flag: number;
  updatedAt: Date;
}

export interface NewTag {
  id?: string;
  userId?: string | null;
  tagCollId?: string | null;
  name: string;
  rawName: string;
  isStandard?: boolean;
  flag?: number;
  updatedAt?: Date;
}

export interface TagInstanceRow {
  id: string;
  tagId: string;
  component: string;
  itemType: string;
  itemId: string;
  contextId: string;
  tiUserId: string | null;
  ordering: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTagInstance {
  id?: string;
  tagId: string;
  component: string;
  itemType: string;
  itemId: string;
  contextId: string;
  tiUserId?: string | null;
  ordering?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TagCorrelationRow {
  tagId: string;
  correlatedTags: string;
}

export interface CommentRow {
  id: string;
  contextId: string;
  component: string;
  commentArea: string;
  itemId: string;
  content: string;
  format: number;
  userId: string;
  createdAt: Date;
  timeDeleted: Date | null;
}

export interface NewComment {
  id?: string;
  contextId: string;
  component: string;
  commentArea: string;
  itemId: string;
  content: string;
  format?: number;
  userId: string;
  createdAt?: Date;
  timeDeleted?: Date | null;
}

export interface RatingRow {
  id: string;
  contextId: string;
  component: string;
  ratingArea: string;
  itemId: string;
  scaleId: number;
  rating: number;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewRating {
  id?: string;
  contextId: string;
  component: string;
  ratingArea: string;
  itemId: string;
  scaleId: number;
  rating: number;
  userId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NoteRow {
  id: string;
  courseId: string | null;
  userId: string;
  createdBy: string;
  content: string;
  format: number;
  publishState: string;
  groupId: string | null;
  userModified: string | null;
  created: Date;
  lastModified: Date;
}

export interface NewNote {
  id?: string;
  courseId?: string | null;
  userId: string;
  createdBy: string;
  content?: string;
  format?: number;
  publishState?: string;
  groupId?: string | null;
  userModified?: string | null;
  created?: Date;
  lastModified?: Date;
}

const TAG_COLLECTION_COLUMNS = [
  'id',
  'name',
  'is_standard as isStandard',
  'component',
  'searchable',
  'custom_url as customUrl',
] as const;

const TAG_COLUMNS = [
  'id',
  'user_id as userId',
  'tag_coll_id as tagCollId',
  'name',
  'raw_name as rawName',
  'is_standard as isStandard',
  'flag',
  'updated_at as updatedAt',
] as const;

const TAG_INSTANCE_COLUMNS = [
  'id',
  'tag_id as tagId',
  'component',
  'item_type as itemType',
  'item_id as itemId',
  'context_id as contextId',
  'ti_user_id as tiUserId',
  'ordering',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const TAG_CORRELATION_COLUMNS = ['tag_id as tagId', 'correlated_tags as correlatedTags'] as const;

const COMMENT_COLUMNS = [
  'id',
  'context_id as contextId',
  'component',
  'comment_area as commentArea',
  'item_id as itemId',
  'content',
  'format',
  'user_id as userId',
  'created_at as createdAt',
  'time_deleted as timeDeleted',
] as const;

const RATING_COLUMNS = [
  'id',
  'context_id as contextId',
  'component',
  'rating_area as ratingArea',
  'item_id as itemId',
  'scale_id as scaleId',
  'rating',
  'user_id as userId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const NOTE_COLUMNS = [
  'id',
  'course_id as courseId',
  'user_id as userId',
  'created_by as createdBy',
  'content',
  'format',
  'publish_state as publishState',
  'group_id as groupId',
  'user_modified as userModified',
  'created',
  'last_modified as lastModified',
] as const;

function tagInsertValues(values: NewTag): Insertable<CentreDB['tag']> {
  const row: Insertable<CentreDB['tag']> = { name: values.name, raw_name: values.rawName };
  if (values.id !== undefined) row.id = values.id;
  if (values.userId !== undefined) row.user_id = values.userId;
  if (values.tagCollId !== undefined) row.tag_coll_id = values.tagCollId;
  if (values.isStandard !== undefined) row.is_standard = values.isStandard;
  if (values.flag !== undefined) row.flag = values.flag;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function tagInstanceInsertValues(values: NewTagInstance): Insertable<CentreDB['tag_instance']> {
  const row: Insertable<CentreDB['tag_instance']> = {
    tag_id: values.tagId,
    component: values.component,
    item_type: values.itemType,
    item_id: values.itemId,
    context_id: values.contextId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.tiUserId !== undefined) row.ti_user_id = values.tiUserId;
  if (values.ordering !== undefined) row.ordering = values.ordering;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function commentInsertValues(values: NewComment): Insertable<CentreDB['comments']> {
  const row: Insertable<CentreDB['comments']> = {
    context_id: values.contextId,
    component: values.component,
    comment_area: values.commentArea,
    item_id: values.itemId,
    content: values.content,
    user_id: values.userId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.format !== undefined) row.format = values.format;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.timeDeleted !== undefined) row.time_deleted = values.timeDeleted;
  return row;
}

function ratingInsertValues(values: NewRating): Insertable<CentreDB['rating']> {
  const row: Insertable<CentreDB['rating']> = {
    context_id: values.contextId,
    component: values.component,
    rating_area: values.ratingArea,
    item_id: values.itemId,
    scale_id: values.scaleId,
    rating: values.rating,
    user_id: values.userId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function noteInsertValues(values: NewNote): Insertable<CentreDB['notes']> {
  const row: Insertable<CentreDB['notes']> = { user_id: values.userId, created_by: values.createdBy };
  if (values.id !== undefined) row.id = values.id;
  if (values.courseId !== undefined) row.course_id = values.courseId;
  if (values.content !== undefined) row.content = values.content;
  if (values.format !== undefined) row.format = values.format;
  if (values.publishState !== undefined) row.publish_state = values.publishState;
  if (values.groupId !== undefined) row.group_id = values.groupId;
  if (values.userModified !== undefined) row.user_modified = values.userModified;
  if (values.created !== undefined) row.created = values.created;
  if (values.lastModified !== undefined) row.last_modified = values.lastModified;
  return row;
}

export class SocialRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }


  async ensureDefaultCollection(db: RepoDb = this.db()): Promise<string> {
    const existing = await db
      .selectFrom('tag_collection')
      .select(TAG_COLLECTION_COLUMNS)
      .where('name', '=', 'Default collection')
      .limit(1)
      .executeTakeFirst();
    if (existing) return existing.id;
    const rows = await db
      .insertInto('tag_collection')
      .values({ name: 'Default collection', is_standard: true })
      .returning(TAG_COLLECTION_COLUMNS)
      .execute();
    return rows[0]!.id;
  }

  async listCollections(db: RepoDb = this.db()): Promise<TagCollectionRow[]> {
    return db.selectFrom('tag_collection').select(TAG_COLLECTION_COLUMNS).orderBy('id', 'asc').execute();
  }

  async findTag(tagCollId: string, name: string, db: RepoDb = this.db()): Promise<TagRow | undefined> {
    return db
      .selectFrom('tag')
      .select(TAG_COLUMNS)
      .where('tag_coll_id', '=', tagCollId)
      .where('name', '=', name)
      .limit(1)
      .executeTakeFirst();
  }

  async insertTag(values: NewTag, db: RepoDb = this.db()): Promise<TagRow> {
    const rows = await db.insertInto('tag').values(tagInsertValues(values)).returning(TAG_COLUMNS).execute();
    return rows[0]!;
  }

  async getTag(id: string, db: RepoDb = this.db()): Promise<TagRow | undefined> {
    return db.selectFrom('tag').select(TAG_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async listInstancesForItem(
    component: string,
    itemType: string,
    itemId: string,
    db: RepoDb = this.db(),
  ): Promise<TagInstanceRow[]> {
    return db
      .selectFrom('tag_instance')
      .select(TAG_INSTANCE_COLUMNS)
      .where('component', '=', component)
      .where('item_type', '=', itemType)
      .where('item_id', '=', itemId)
      .orderBy('ordering', 'asc')
      .execute();
  }

  async listInstancesForTag(tagId: string, db: RepoDb = this.db()): Promise<TagInstanceRow[]> {
    return db
      .selectFrom('tag_instance')
      .select(TAG_INSTANCE_COLUMNS)
      .where('tag_id', '=', tagId)
      .execute();
  }

  async insertInstance(values: NewTagInstance, db: RepoDb = this.db()): Promise<TagInstanceRow> {
    const rows = await db
      .insertInto('tag_instance')
      .values(tagInstanceInsertValues(values))
      .onConflict((oc) =>
        oc.columns(['tag_id', 'component', 'item_type', 'item_id', 'context_id', 'ti_user_id']).doNothing(),
      )
      .returning(TAG_INSTANCE_COLUMNS)
      .execute();
    if (rows[0]) return rows[0];
    let query = db
      .selectFrom('tag_instance')
      .select(TAG_INSTANCE_COLUMNS)
      .where('tag_id', '=', values.tagId)
      .where('component', '=', values.component)
      .where('item_type', '=', values.itemType)
      .where('item_id', '=', values.itemId)
      .where('context_id', '=', values.contextId);
    query = values.tiUserId ? query.where('ti_user_id', '=', values.tiUserId) : query.where('ti_user_id', 'is', null);
    const existing = await query.limit(1).executeTakeFirst();
    return existing!;
  }

  async deleteInstancesForItem(
    component: string,
    itemType: string,
    itemId: string,
    contextId: string,
    db: RepoDb = this.db(),
  ): Promise<void> {
    await db
      .deleteFrom('tag_instance')
      .where('component', '=', component)
      .where('item_type', '=', itemType)
      .where('item_id', '=', itemId)
      .where('context_id', '=', contextId)
      .execute();
  }

  async upsertCorrelation(tagId: string, correlatedTags: string, db: RepoDb = this.db()): Promise<void> {
    await db
      .insertInto('tag_correlation')
      .values({ tag_id: tagId, correlated_tags: correlatedTags })
      .onConflict((oc) => oc.column('tag_id').doUpdateSet({ correlated_tags: correlatedTags }))
      .execute();
  }

  async getCorrelation(tagId: string, db: RepoDb = this.db()): Promise<TagCorrelationRow | undefined> {
    return db
      .selectFrom('tag_correlation')
      .select(TAG_CORRELATION_COLUMNS)
      .where('tag_id', '=', tagId)
      .limit(1)
      .executeTakeFirst();
  }


  async insertComment(values: NewComment, db: RepoDb = this.db()): Promise<CommentRow> {
    const rows = await db
      .insertInto('comments')
      .values(commentInsertValues(values))
      .returning(COMMENT_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getComment(id: string, db: RepoDb = this.db()): Promise<CommentRow | undefined> {
    return db.selectFrom('comments').select(COMMENT_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async listComments(
    component: string,
    commentArea: string,
    itemId: string,
    contextId: string,
    db: RepoDb = this.db(),
  ): Promise<CommentRow[]> {
    return db
      .selectFrom('comments')
      .select(COMMENT_COLUMNS)
      .where('component', '=', component)
      .where('comment_area', '=', commentArea)
      .where('item_id', '=', itemId)
      .where('context_id', '=', contextId)
      .where('time_deleted', 'is', null)
      .orderBy('id', 'desc')
      .execute();
  }

  async softDeleteComment(id: string, db: RepoDb = this.db()): Promise<void> {
    await db.updateTable('comments').set({ time_deleted: new Date() }).where('id', '=', id).execute();
  }


  async upsertRating(values: NewRating, db: RepoDb = this.db()): Promise<RatingRow> {
    const rows = await db
      .insertInto('rating')
      .values(ratingInsertValues(values))
      .onConflict((oc) =>
        oc
          .columns(['context_id', 'component', 'rating_area', 'item_id', 'user_id'])
          .doUpdateSet({ rating: values.rating, scale_id: values.scaleId, updated_at: new Date() }),
      )
      .returning(RATING_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listRatings(
    component: string,
    ratingArea: string,
    itemId: string,
    contextId: string,
    db: RepoDb = this.db(),
  ): Promise<RatingRow[]> {
    return db
      .selectFrom('rating')
      .select(RATING_COLUMNS)
      .where('component', '=', component)
      .where('rating_area', '=', ratingArea)
      .where('item_id', '=', itemId)
      .where('context_id', '=', contextId)
      .orderBy('id', 'asc')
      .execute();
  }


  async insertNote(values: NewNote, db: RepoDb = this.db()): Promise<NoteRow> {
    const rows = await db.insertInto('notes').values(noteInsertValues(values)).returning(NOTE_COLUMNS).execute();
    return rows[0]!;
  }

  async getNote(id: string, db: RepoDb = this.db()): Promise<NoteRow | undefined> {
    return db.selectFrom('notes').select(NOTE_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async listNotesAbout(userId: string, db: RepoDb = this.db()): Promise<NoteRow[]> {
    return db
      .selectFrom('notes')
      .select(NOTE_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'desc')
      .execute();
  }

  async deleteNote(id: string, db: RepoDb = this.db()): Promise<void> {
    await db.deleteFrom('notes').where('id', '=', id).execute();
  }
}
