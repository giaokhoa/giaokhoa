import type { CentreDb, CentreTx } from '../client';


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
    ...(v.id !== undefined ? { id: v.id } : {}),
    course_id: v.courseId,
    ...(v.itemType !== undefined ? { item_type: v.itemType } : {}),
    ...(v.itemModule !== undefined ? { item_module: v.itemModule } : {}),
    ...(v.itemInstance !== undefined ? { item_instance: v.itemInstance } : {}),
    ...(v.itemName !== undefined ? { item_name: v.itemName } : {}),
    ...(v.idNumber !== undefined ? { id_number: v.idNumber } : {}),
    ...(v.gradeType !== undefined ? { grade_type: v.gradeType } : {}),
    ...(v.gradeMin !== undefined ? { grade_min: v.gradeMin } : {}),
    ...(v.gradeMax !== undefined ? { grade_max: v.gradeMax } : {}),
    ...(v.gradePass !== undefined ? { grade_pass: v.gradePass } : {}),
    ...(v.hidden !== undefined ? { hidden: v.hidden } : {}),
    ...(v.locked !== undefined ? { locked: v.locked } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
    ...(v.multiplicator !== undefined ? { multiplicator: v.multiplicator } : {}),
    ...(v.plusFactor !== undefined ? { plus_factor: v.plusFactor } : {}),
    ...(v.postingPolicy !== undefined ? { posting_policy: v.postingPolicy } : {}),
    ...(v.createdAt !== undefined ? { created_at: v.createdAt } : {}),
    ...(v.updatedAt !== undefined ? { updated_at: v.updatedAt } : {}),
  };
}

function itemUpdateSet(patch: Partial<ItemRow>) {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.courseId !== undefined ? { course_id: patch.courseId } : {}),
    ...(patch.itemType !== undefined ? { item_type: patch.itemType } : {}),
    ...(patch.itemModule !== undefined ? { item_module: patch.itemModule } : {}),
    ...(patch.itemInstance !== undefined ? { item_instance: patch.itemInstance } : {}),
    ...(patch.itemName !== undefined ? { item_name: patch.itemName } : {}),
    ...(patch.idNumber !== undefined ? { id_number: patch.idNumber } : {}),
    ...(patch.gradeType !== undefined ? { grade_type: patch.gradeType } : {}),
    ...(patch.gradeMin !== undefined ? { grade_min: patch.gradeMin } : {}),
    ...(patch.gradeMax !== undefined ? { grade_max: patch.gradeMax } : {}),
    ...(patch.gradePass !== undefined ? { grade_pass: patch.gradePass } : {}),
    ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
    ...(patch.multiplicator !== undefined ? { multiplicator: patch.multiplicator } : {}),
    ...(patch.plusFactor !== undefined ? { plus_factor: patch.plusFactor } : {}),
    ...(patch.postingPolicy !== undefined ? { posting_policy: patch.postingPolicy } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    updated_at: new Date(),
  };
}

function gradeInsertValues(v: NewGrade) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    item_id: v.itemId,
    user_id: v.userId,
    ...(v.rawGrade !== undefined ? { raw_grade: v.rawGrade } : {}),
    ...(v.finalGrade !== undefined ? { final_grade: v.finalGrade } : {}),
    ...(v.rawGradeMax !== undefined ? { raw_grade_max: v.rawGradeMax } : {}),
    ...(v.rawGradeMin !== undefined ? { raw_grade_min: v.rawGradeMin } : {}),
    ...(v.hidden !== undefined ? { hidden: v.hidden } : {}),
    ...(v.locked !== undefined ? { locked: v.locked } : {}),
    ...(v.overridden !== undefined ? { overridden: v.overridden } : {}),
    ...(v.excluded !== undefined ? { excluded: v.excluded } : {}),
    ...(v.feedback !== undefined ? { feedback: v.feedback } : {}),
    ...(v.frozen !== undefined ? { frozen: v.frozen } : {}),
    ...(v.aggregationStatus !== undefined ? { aggregation_status: v.aggregationStatus } : {}),
    ...(v.aggregationWeight !== undefined ? { aggregation_weight: v.aggregationWeight } : {}),
    ...(v.lockTime !== undefined ? { lock_time: v.lockTime } : {}),
    ...(v.information !== undefined ? { information: v.information } : {}),
    ...(v.createdAt !== undefined ? { created_at: v.createdAt } : {}),
    ...(v.updatedAt !== undefined ? { updated_at: v.updatedAt } : {}),
  };
}

function gradeConflictSet(v: NewGrade) {
  return {
    ...(v.rawGrade !== undefined ? { raw_grade: v.rawGrade } : {}),
    ...(v.finalGrade !== undefined ? { final_grade: v.finalGrade } : {}),
    ...(v.hidden !== undefined ? { hidden: v.hidden } : {}),
    ...(v.locked !== undefined ? { locked: v.locked } : {}),
    ...(v.overridden !== undefined ? { overridden: v.overridden } : {}),
    ...(v.excluded !== undefined ? { excluded: v.excluded } : {}),
    ...(v.frozen !== undefined ? { frozen: v.frozen } : {}),
    ...(v.feedback !== undefined ? { feedback: v.feedback } : {}),
    ...(v.aggregationStatus !== undefined ? { aggregation_status: v.aggregationStatus } : {}),
    ...(v.aggregationWeight !== undefined ? { aggregation_weight: v.aggregationWeight } : {}),
    ...(v.lockTime !== undefined ? { lock_time: v.lockTime } : {}),
    updated_at: new Date(),
  };
}

function gradeUpdateSet(patch: Partial<GradeRow>) {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.itemId !== undefined ? { item_id: patch.itemId } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.rawGrade !== undefined ? { raw_grade: patch.rawGrade } : {}),
    ...(patch.finalGrade !== undefined ? { final_grade: patch.finalGrade } : {}),
    ...(patch.rawGradeMax !== undefined ? { raw_grade_max: patch.rawGradeMax } : {}),
    ...(patch.rawGradeMin !== undefined ? { raw_grade_min: patch.rawGradeMin } : {}),
    ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
    ...(patch.overridden !== undefined ? { overridden: patch.overridden } : {}),
    ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}),
    ...(patch.feedback !== undefined ? { feedback: patch.feedback } : {}),
    ...(patch.frozen !== undefined ? { frozen: patch.frozen } : {}),
    ...(patch.aggregationStatus !== undefined ? { aggregation_status: patch.aggregationStatus } : {}),
    ...(patch.aggregationWeight !== undefined ? { aggregation_weight: patch.aggregationWeight } : {}),
    ...(patch.lockTime !== undefined ? { lock_time: patch.lockTime } : {}),
    ...(patch.information !== undefined ? { information: patch.information } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    updated_at: new Date(),
  };
}

function historyInsertValues(v: NewGradeHistory) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    item_id: v.itemId,
    user_id: v.userId,
    ...(v.oldId !== undefined ? { old_id: v.oldId } : {}),
    ...(v.action !== undefined ? { action: v.action } : {}),
    ...(v.rawGrade !== undefined ? { raw_grade: v.rawGrade } : {}),
    ...(v.finalGrade !== undefined ? { final_grade: v.finalGrade } : {}),
    ...(v.excluded !== undefined ? { excluded: v.excluded } : {}),
    ...(v.frozen !== undefined ? { frozen: v.frozen } : {}),
    ...(v.overridden !== undefined ? { overridden: v.overridden } : {}),
    ...(v.source !== undefined ? { source: v.source } : {}),
    ...(v.loggedUser !== undefined ? { logged_user: v.loggedUser } : {}),
    ...(v.updatedAt !== undefined ? { updated_at: v.updatedAt } : {}),
  };
}

function publicationInsertValues(v: NewGradePublication) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    course_id: v.courseId,
    ...(v.itemId !== undefined ? { item_id: v.itemId } : {}),
    action: v.action,
    scope: v.scope,
    actor_id: v.actorId,
    ...(v.note !== undefined ? { note: v.note } : {}),
    ...(v.createdAt !== undefined ? { created_at: v.createdAt } : {}),
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
