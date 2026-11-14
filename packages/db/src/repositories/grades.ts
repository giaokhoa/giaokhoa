import type { CentreDb, CentreTx } from '../client';
import { pickDefined } from './mapping';


export interface ItemRow {
  id: string;
  courseId: string;
  itemType: string;
  itemModule: string | null;
  itemInstance: string | null;
  itemName: string;
  idNumber: string | null;
  gradeType: string;
  gradeMin: number;
  gradeMax: number;
  gradePass: number;
  hidden: boolean;
  locked: boolean;
  sortOrder: number;
  multiplicator: number;
  plusFactor: number;
  postingPolicy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GradeRow {
  id: string;
  itemId: string;
  userId: string;
  rawGrade: number | null;
  finalGrade: number | null;
  rawGradeMax: number;
  rawGradeMin: number;
  hidden: boolean;
  locked: boolean;
  overridden: boolean;
  excluded: boolean;
  feedback: string | null;
  frozen: boolean;
  aggregationStatus: string;
  aggregationWeight: number | null;
  lockTime: Date | null;
  information: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GradeHistoryRow {
  id: string;
  itemId: string;
  userId: string;
  oldId: string | null;
  action: number;
  rawGrade: number | null;
  finalGrade: number | null;
  excluded: boolean;
  frozen: boolean;
  overridden: boolean;
  source: string | null;
  loggedUser: string | null;
  updatedAt: Date;
}

export interface GradePublicationRow {
  id: string;
  courseId: string;
  itemId: string | null;
  action: string;
  scope: string;
  actorId: string;
  note: string | null;
  createdAt: Date;
}

export type GradesDb = CentreDb | CentreTx;
export type GradesTx = CentreTx;


export interface NewGradeItem {
  id?: string;
  courseId: string;
  itemType?: string;
  itemModule?: string | null;
  itemInstance?: string | null;
  itemName?: string;
  idNumber?: string | null;
  gradeType?: string;
  gradeMin?: number;
  gradeMax?: number;
  gradePass?: number;
  hidden?: boolean;
  locked?: boolean;
  sortOrder?: number;
  multiplicator?: number;
  plusFactor?: number;
  postingPolicy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewGrade {
  id?: string;
  itemId: string;
  userId: string;
  rawGrade?: number | null;
  finalGrade?: number | null;
  rawGradeMax?: number;
  rawGradeMin?: number;
  hidden?: boolean;
  locked?: boolean;
  overridden?: boolean;
  excluded?: boolean;
  feedback?: string | null;
  frozen?: boolean;
  aggregationStatus?: string;
  aggregationWeight?: number | null;
  lockTime?: Date | null;
  information?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewGradeHistory {
  id?: string;
  itemId: string;
  userId: string;
  oldId?: string | null;
  action?: number;
  rawGrade?: number | null;
  finalGrade?: number | null;
  excluded?: boolean;
  frozen?: boolean;
  overridden?: boolean;
  source?: string | null;
  loggedUser?: string | null;
  updatedAt?: Date;
}

export interface NewGradePublication {
  id?: string;
  courseId: string;
  itemId?: string | null;
  action: string;
  scope: string;
  actorId: string;
  note?: string | null;
  createdAt?: Date;
}


const ITEM_COLUMNS = [
  'id', 'course_id as courseId', 'item_type as itemType',
  'item_module as itemModule', 'item_instance as itemInstance',
  'item_name as itemName', 'id_number as idNumber',
  'grade_type as gradeType', 'grade_min as gradeMin',
  'grade_max as gradeMax', 'grade_pass as gradePass', 'hidden', 'locked',
  'sort_order as sortOrder', 'multiplicator', 'plus_factor as plusFactor',
  'posting_policy as postingPolicy',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const GRADE_COLUMNS = [
  'id', 'item_id as itemId', 'user_id as userId',
  'raw_grade as rawGrade', 'final_grade as finalGrade',
  'raw_grade_max as rawGradeMax', 'raw_grade_min as rawGradeMin',
  'hidden', 'locked', 'overridden', 'excluded', 'feedback', 'frozen',
  'aggregation_status as aggregationStatus',
  'aggregation_weight as aggregationWeight', 'lock_time as lockTime',
  'information', 'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const HISTORY_COLUMNS = [
  'id', 'item_id as itemId', 'user_id as userId', 'old_id as oldId',
  'action', 'raw_grade as rawGrade', 'final_grade as finalGrade',
  'excluded', 'frozen', 'overridden', 'source',
  'logged_user as loggedUser', 'updated_at as updatedAt',
] as const;

const PUBLICATION_COLUMNS = [
  'id', 'course_id as courseId', 'item_id as itemId', 'action', 'scope',
  'actor_id as actorId', 'note', 'created_at as createdAt',
] as const;


function itemInsertValues(v: NewGradeItem) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    course_id: v.courseId,
    ...pickDefined(v, [
      ['itemType', 'item_type'],
      ['itemModule', 'item_module'],
      ['itemInstance', 'item_instance'],
      ['itemName', 'item_name'],
      ['idNumber', 'id_number'],
      ['gradeType', 'grade_type'],
      ['gradeMin', 'grade_min'],
      ['gradeMax', 'grade_max'],
      ['gradePass', 'grade_pass'],
      ['hidden', 'hidden'],
      ['locked', 'locked'],
      ['sortOrder', 'sort_order'],
      ['multiplicator', 'multiplicator'],
      ['plusFactor', 'plus_factor'],
      ['postingPolicy', 'posting_policy'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function itemUpdateSet(patch: Partial<ItemRow>) {
  return {
    ...pickDefined(patch, [
      ['id', 'id'],
      ['courseId', 'course_id'],
      ['itemType', 'item_type'],
      ['itemModule', 'item_module'],
      ['itemInstance', 'item_instance'],
      ['itemName', 'item_name'],
      ['idNumber', 'id_number'],
      ['gradeType', 'grade_type'],
      ['gradeMin', 'grade_min'],
      ['gradeMax', 'grade_max'],
      ['gradePass', 'grade_pass'],
      ['hidden', 'hidden'],
      ['locked', 'locked'],
      ['sortOrder', 'sort_order'],
      ['multiplicator', 'multiplicator'],
      ['plusFactor', 'plus_factor'],
      ['postingPolicy', 'posting_policy'],
      ['createdAt', 'created_at'],
    ]),
    updated_at: new Date(),
  };
}

function gradeInsertValues(v: NewGrade) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    item_id: v.itemId,
    user_id: v.userId,
    ...pickDefined(v, [
      ['rawGrade', 'raw_grade'],
      ['finalGrade', 'final_grade'],
      ['rawGradeMax', 'raw_grade_max'],
      ['rawGradeMin', 'raw_grade_min'],
      ['hidden', 'hidden'],
      ['locked', 'locked'],
      ['overridden', 'overridden'],
      ['excluded', 'excluded'],
      ['feedback', 'feedback'],
      ['frozen', 'frozen'],
      ['aggregationStatus', 'aggregation_status'],
      ['aggregationWeight', 'aggregation_weight'],
      ['lockTime', 'lock_time'],
      ['information', 'information'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function gradeConflictSet(v: NewGrade) {
  return {
    ...pickDefined(v, [
      ['rawGrade', 'raw_grade'],
      ['finalGrade', 'final_grade'],
      ['hidden', 'hidden'],
      ['locked', 'locked'],
      ['overridden', 'overridden'],
      ['excluded', 'excluded'],
      ['frozen', 'frozen'],
      ['feedback', 'feedback'],
      ['aggregationStatus', 'aggregation_status'],
      ['aggregationWeight', 'aggregation_weight'],
      ['lockTime', 'lock_time'],
    ]),
    updated_at: new Date(),
  };
}

function gradeUpdateSet(patch: Partial<GradeRow>) {
  return {
    ...pickDefined(patch, [
      ['id', 'id'],
      ['itemId', 'item_id'],
      ['userId', 'user_id'],
      ['rawGrade', 'raw_grade'],
      ['finalGrade', 'final_grade'],
      ['rawGradeMax', 'raw_grade_max'],
      ['rawGradeMin', 'raw_grade_min'],
      ['hidden', 'hidden'],
      ['locked', 'locked'],
      ['overridden', 'overridden'],
      ['excluded', 'excluded'],
      ['feedback', 'feedback'],
      ['frozen', 'frozen'],
      ['aggregationStatus', 'aggregation_status'],
      ['aggregationWeight', 'aggregation_weight'],
      ['lockTime', 'lock_time'],
      ['information', 'information'],
      ['createdAt', 'created_at'],
    ]),
    updated_at: new Date(),
  };
}

function historyInsertValues(v: NewGradeHistory) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    item_id: v.itemId,
    user_id: v.userId,
    ...pickDefined(v, [
      ['oldId', 'old_id'],
      ['action', 'action'],
      ['rawGrade', 'raw_grade'],
      ['finalGrade', 'final_grade'],
      ['excluded', 'excluded'],
      ['frozen', 'frozen'],
      ['overridden', 'overridden'],
      ['source', 'source'],
      ['loggedUser', 'logged_user'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function publicationInsertValues(v: NewGradePublication) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    course_id: v.courseId,
    ...pickDefined(v, [['itemId', 'item_id']]),
    action: v.action,
    scope: v.scope,
    actor_id: v.actorId,
    ...pickDefined(v, [
      ['note', 'note'],
      ['createdAt', 'created_at'],
    ]),
  };
}

export class GradesRepository {
  constructor(private readonly handle: CentreDb) {}

  db(): CentreDb {
    return this.handle;
  }

  transaction<T>(fn: (tx: GradesTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  async insertItem(v: NewGradeItem, tx?: GradesDb): Promise<ItemRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('grade_items')
      .values(itemInsertValues(v))
      .returning(ITEM_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getItem(id: string, tx?: GradesDb): Promise<ItemRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_items')
      .select(ITEM_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listItems(courseId: string, tx?: GradesDb): Promise<ItemRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_items')
      .select(ITEM_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
  }

  async findItemByTypeInstance(courseId: string, itemType: string, itemInstance: string, tx?: GradesDb): Promise<ItemRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_items')
      .select(ITEM_COLUMNS)
      .where('course_id', '=', courseId)
      .where('item_type', '=', itemType)
      .where('item_instance', '=', itemInstance)
      .executeTakeFirst();
  }

  async findItemForCm(courseId: string, cmId: string, tx?: GradesDb): Promise<ItemRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_items')
      .select(ITEM_COLUMNS)
      .where('course_id', '=', courseId)
      .where('item_type', '=', 'mod')
      .where('item_instance', '=', cmId)
      .executeTakeFirst();
  }

  async findItemByIdnumber(courseId: string, idNumber: string, tx?: GradesDb): Promise<ItemRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_items')
      .select(ITEM_COLUMNS)
      .where('course_id', '=', courseId)
      .where('id_number', '=', idNumber)
      .executeTakeFirst();
  }

  async updateItem(id: string, patch: Partial<ItemRow>, tx?: GradesDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .updateTable('grade_items')
      .set(itemUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async deleteItem(id: string, tx?: GradesDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .deleteFrom('grade_items')
      .where('id', '=', id)
      .execute();
  }

  async getGrade(itemId: string, userId: string, tx?: GradesDb): Promise<GradeRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_grades')
      .select(GRADE_COLUMNS)
      .where('item_id', '=', itemId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  async listGradesForCourse(courseId: string, userId?: string, tx?: GradesDb): Promise<GradeRow[]> {
    const db = tx ?? this.handle;
    const items = await this.listItems(courseId, tx);
    if (!items.length) return [];
    let query = db
      .selectFrom('grade_grades')
      .select(GRADE_COLUMNS)
      .where('item_id', 'in', items.map((i) => i.id));
    if (userId !== undefined) query = query.where('user_id', '=', userId);
    return query.execute();
  }

  async getGradeById(id: string, tx?: GradesDb): Promise<GradeRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_grades')
      .select(GRADE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listGradesForItem(itemId: string, tx?: GradesDb): Promise<GradeRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_grades')
      .select(GRADE_COLUMNS)
      .where('item_id', '=', itemId)
      .execute();
  }

  async upsertGrade(v: NewGrade, tx?: GradesDb): Promise<GradeRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('grade_grades')
      .values(gradeInsertValues(v))
      .onConflict((oc) => oc
        .columns(['item_id', 'user_id'])
        .doUpdateSet(gradeConflictSet(v)))
      .returning(GRADE_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async updateGrade(id: string, patch: Partial<GradeRow>, tx?: GradesDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .updateTable('grade_grades')
      .set(gradeUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async insertHistory(v: NewGradeHistory, tx?: GradesDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .insertInto('grade_grades_history')
      .values(historyInsertValues(v))
      .execute();
  }

  async listHistory(itemId: string, userId: string, tx?: GradesDb): Promise<GradeHistoryRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_grades_history')
      .select(HISTORY_COLUMNS)
      .where('item_id', '=', itemId)
      .where('user_id', '=', userId)
      .orderBy('id')
      .execute();
  }

  async insertPublication(v: NewGradePublication, tx?: GradesDb): Promise<GradePublicationRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('grade_publications')
      .values(publicationInsertValues(v))
      .returning(PUBLICATION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async listPublications(courseId: string, tx?: GradesDb): Promise<GradePublicationRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('grade_publications')
      .select(PUBLICATION_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
  }
}
