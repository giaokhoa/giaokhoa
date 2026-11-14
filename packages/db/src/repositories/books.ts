import { sql, type Insertable, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

type RepoDb = CentreDb | CentreTx;

export interface BookRow {
  id: string;
  kind: string;
  title: string;
  subjectId: string | null;
  grade: number | null;
  series: string | null;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn: string | null;
  attributionPublic: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBook {
  id?: string;
  kind?: string;
  title: string;
  subjectId?: string | null;
  grade?: number | null;
  series?: string | null;
  author?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  isbn?: string | null;
  attributionPublic?: boolean;
  position?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BookNodeRow {
  id: string;
  bookId: string;
  parentId: string | null;
  title: string;
  kind: string;
  volume: number | null;
  lessonNumber: number | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBookNode {
  id?: string;
  bookId: string;
  parentId?: string | null;
  title: string;
  kind?: string;
  volume?: number | null;
  lessonNumber?: number | null;
  position?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BookMappingRow {
  id: string;
  bookNodeId: string;
  curriculumNodeId: string | null;
  learningOutcomeId: string | null;
  position: number;
  createdAt: Date;
}

export interface NewBookMapping {
  id?: string;
  bookNodeId: string;
  curriculumNodeId?: string | null;
  learningOutcomeId?: string | null;
  position: number;
  createdAt?: Date;
}

export interface BookRecordRow {
  id: string;
  datasetKey: string;
  recordId: string;
  bookId: string;
  nodeId: string;
  contentHash: string;
  source: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBookRecord {
  id?: string;
  datasetKey: string;
  recordId: string;
  bookId: string;
  nodeId: string;
  contentHash: string;
  source: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BookSourceQuestionRow {
  id: string;
  qtype: string;
  category: string;
  createdBy: string | null;
  copyCount: number;
}

const BOOK_COLUMNS = [
  'id',
  'kind',
  'title',
  'subject_id as subjectId',
  'grade',
  'series',
  'author',
  'publisher',
  'published_year as publishedYear',
  'isbn',
  'attribution_public as attributionPublic',
  'position',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const BOOK_NODE_COLUMNS = [
  'id',
  'book_id as bookId',
  'parent_id as parentId',
  'title',
  'kind',
  'volume',
  'lesson_number as lessonNumber',
  'position',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const BOOK_MAPPING_COLUMNS = [
  'id',
  'book_node_id as bookNodeId',
  'curriculum_node_id as curriculumNodeId',
  'learning_outcome_id as learningOutcomeId',
  'position',
  'created_at as createdAt',
] as const;

const BOOK_RECORD_COLUMNS = [
  'id',
  'dataset_key as datasetKey',
  'record_id as recordId',
  'book_id as bookId',
  'node_id as nodeId',
  'content_hash as contentHash',
  'source',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

function bookInsertValues(values: NewBook): Insertable<CentreDB['books']> {
  const row: Insertable<CentreDB['books']> = { title: values.title };
  applyDefined(row, values, [
    ['id', 'id'],
    ['kind', 'kind'],
    ['subjectId', 'subject_id'],
    ['grade', 'grade'],
    ['series', 'series'],
    ['author', 'author'],
    ['publisher', 'publisher'],
    ['publishedYear', 'published_year'],
    ['isbn', 'isbn'],
    ['attributionPublic', 'attribution_public'],
    ['position', 'position'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function bookNodeInsertValues(values: NewBookNode): Insertable<CentreDB['book_nodes']> {
  const row: Insertable<CentreDB['book_nodes']> = { book_id: values.bookId, title: values.title };
  applyDefined(row, values, [
    ['id', 'id'],
    ['parentId', 'parent_id'],
    ['kind', 'kind'],
    ['volume', 'volume'],
    ['lessonNumber', 'lesson_number'],
    ['position', 'position'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function bookNodeUpdateSet(patch: Partial<NewBookNode>): UpdateObject<CentreDB, 'book_nodes'> {
  const set: UpdateObject<CentreDB, 'book_nodes'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['bookId', 'book_id'],
    ['parentId', 'parent_id'],
    ['title', 'title'],
    ['kind', 'kind'],
    ['volume', 'volume'],
    ['lessonNumber', 'lesson_number'],
    ['position', 'position'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function bookMappingInsertValues(values: NewBookMapping): Insertable<CentreDB['book_mappings']> {
  const row: Insertable<CentreDB['book_mappings']> = {
    book_node_id: values.bookNodeId,
    position: values.position,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['curriculumNodeId', 'curriculum_node_id'],
    ['learningOutcomeId', 'learning_outcome_id'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function bookRecordInsertValues(values: NewBookRecord): InsertObject<CentreDB, 'book_records'> {
  const row: InsertObject<CentreDB, 'book_records'> = {
    dataset_key: values.datasetKey,
    record_id: values.recordId,
    book_id: values.bookId,
    node_id: values.nodeId,
    content_hash: values.contentHash,
    source: jsonbValue(values.source),
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function bookRecordUpdateSet(patch: Partial<NewBookRecord>): UpdateObject<CentreDB, 'book_records'> {
  const set: UpdateObject<CentreDB, 'book_records'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['datasetKey', 'dataset_key'],
    ['recordId', 'record_id'],
    ['bookId', 'book_id'],
    ['nodeId', 'node_id'],
    ['contentHash', 'content_hash'],
    ['source', 'source', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

export class BookRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }


  async insertBook(values: NewBook, db: RepoDb = this.db()): Promise<BookRow> {
    const rows = await db.insertInto('books').values(bookInsertValues(values)).returning(BOOK_COLUMNS).execute();
    return rows[0]!;
  }

  async getBook(id: string, db: RepoDb = this.db()): Promise<BookRow | undefined> {
    return db.selectFrom('books').select(BOOK_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async findBook(subjectId: string, grade: number, title: string, db: RepoDb = this.db()): Promise<BookRow | undefined> {
    return db
      .selectFrom('books')
      .select(BOOK_COLUMNS)
      .where('subject_id', '=', subjectId)
      .where('grade', '=', grade)
      .where('title', '=', title)
      .limit(1)
      .executeTakeFirst();
  }

  async listBooks(subjectId?: string, kind?: string, db: RepoDb = this.db()): Promise<BookRow[]> {
    let query = db.selectFrom('books').select(BOOK_COLUMNS);
    if (subjectId) query = query.where('subject_id', '=', subjectId);
    if (kind) query = query.where('kind', '=', kind);
    const rows = await query.execute();
    return rows.sort(
      (a, b) => (a.grade ?? 0) - (b.grade ?? 0) || a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }


  async insertBookNode(values: NewBookNode, db: RepoDb = this.db()): Promise<BookNodeRow> {
    const rows = await db
      .insertInto('book_nodes')
      .values(bookNodeInsertValues(values))
      .returning(BOOK_NODE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getBookNode(id: string, db: RepoDb = this.db()): Promise<BookNodeRow | undefined> {
    return db.selectFrom('book_nodes').select(BOOK_NODE_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async listBookNodes(bookId: string, db: RepoDb = this.db()): Promise<BookNodeRow[]> {
    return db
      .selectFrom('book_nodes')
      .select(BOOK_NODE_COLUMNS)
      .where('book_id', '=', bookId)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async updateBookNode(id: string, values: Partial<NewBookNode>, db: RepoDb = this.db()): Promise<void> {
    await db
      .updateTable('book_nodes')
      .set({ ...bookNodeUpdateSet(values), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }


  async insertMapping(values: NewBookMapping, db: RepoDb = this.db()): Promise<BookMappingRow> {
    const rows = await db
      .insertInto('book_mappings')
      .values(bookMappingInsertValues(values))
      .returning(BOOK_MAPPING_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listMappingsForNode(bookNodeId: string, db: RepoDb = this.db()): Promise<BookMappingRow[]> {
    return db
      .selectFrom('book_mappings')
      .select(BOOK_MAPPING_COLUMNS)
      .where('book_node_id', '=', bookNodeId)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async listMappingsForNodes(bookNodeIds: string[], db: RepoDb = this.db()): Promise<BookMappingRow[]> {
    if (bookNodeIds.length === 0) return [];
    return db
      .selectFrom('book_mappings')
      .select(BOOK_MAPPING_COLUMNS)
      .where('book_node_id', 'in', bookNodeIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async deleteMappingsForNode(bookNodeId: string, db: RepoDb = this.db()): Promise<void> {
    await db.deleteFrom('book_mappings').where('book_node_id', '=', bookNodeId).execute();
  }


  async getBookRecord(datasetKey: string, recordId: string, db: RepoDb = this.db()): Promise<BookRecordRow | undefined> {
    return db
      .selectFrom('book_records')
      .select(BOOK_RECORD_COLUMNS)
      .where('dataset_key', '=', datasetKey)
      .where('record_id', '=', recordId)
      .limit(1)
      .executeTakeFirst();
  }

  async listBookRecords(datasetKey: string, db: RepoDb = this.db()): Promise<BookRecordRow[]> {
    return db.selectFrom('book_records').select(BOOK_RECORD_COLUMNS).where('dataset_key', '=', datasetKey).execute();
  }

  async listBookRecordsByBook(bookId: string, db: RepoDb = this.db()): Promise<BookRecordRow[]> {
    return db.selectFrom('book_records').select(BOOK_RECORD_COLUMNS).where('book_id', '=', bookId).execute();
  }

  async insertBookRecord(values: NewBookRecord, db: RepoDb = this.db()): Promise<BookRecordRow> {
    const rows = await db
      .insertInto('book_records')
      .values(bookRecordInsertValues(values))
      .returning(BOOK_RECORD_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async updateBookRecord(id: string, values: Partial<NewBookRecord>, db: RepoDb = this.db()): Promise<void> {
    await db
      .updateTable('book_records')
      .set({ ...bookRecordUpdateSet(values), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async listQuestionsByBookSource(bookId: string, db: RepoDb = this.db()): Promise<BookSourceQuestionRow[]> {
    return db
      .selectFrom('question')
      .select(['id', 'qtype', 'category', 'created_by as createdBy', 'copy_count as copyCount'])
      .where('source_kind', '=', 'book')
      .where('source_ref', '=', bookId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
}
