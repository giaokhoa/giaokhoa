import { sql, type Insertable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

type RepoDb = CentreDb | CentreTx;

export interface FileRow {
  id: string;
  contentHash: string;
  storageDomain: string;
  contextId: string;
  component: string;
  fileArea: string;
  itemId: string | null;
  filePath: string;
  fileName: string;
  userId: string | null;
  fileSize: number;
  mimeType: string | null;
  status: number;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFile {
  id?: string;
  contentHash: string;
  storageDomain: string;
  contextId: string;
  component: string;
  fileArea: string;
  itemId?: string | null;
  filePath?: string;
  fileName: string;
  userId?: string | null;
  fileSize: number;
  mimeType?: string | null;
  status?: number;
  source?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LinkedSubmissionRow {
  submissionId: string;
  assignmentId: string;
  userId: string;
  status: string;
  attemptNumber: number;
}

const FILE_COLUMNS = [
  'id',
  'content_hash as contentHash',
  'storage_domain as storageDomain',
  'context_id as contextId',
  'component',
  'file_area as fileArea',
  'item_id as itemId',
  'file_path as filePath',
  'file_name as fileName',
  'user_id as userId',
  'file_size as fileSize',
  'mime_type as mimeType',
  'status',
  'source',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const LINKED_SUBMISSION_COLUMNS = [
  'assign_submissions.id as submissionId',
  'assign_submissions.assignment_id as assignmentId',
  'assign_submissions.user_id as userId',
  'assign_submissions.status as status',
  'assign_submissions.attempt_number as attemptNumber',
] as const;

function fileInsertValues(values: NewFile): Insertable<CentreDB['files']> {
  const row: Insertable<CentreDB['files']> = {
    content_hash: values.contentHash,
    storage_domain: values.storageDomain,
    context_id: values.contextId,
    component: values.component,
    file_area: values.fileArea,
    file_name: values.fileName,
    file_size: values.fileSize,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.itemId !== undefined) row.item_id = values.itemId;
  if (values.filePath !== undefined) row.file_path = values.filePath;
  if (values.userId !== undefined) row.user_id = values.userId;
  if (values.mimeType !== undefined) row.mime_type = values.mimeType;
  if (values.status !== undefined) row.status = values.status;
  if (values.source !== undefined) row.source = values.source;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

export class FilesRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async withContentLock<T>(storageDomain: string, contentHash: string, fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`file:${storageDomain}/${contentHash}`}, 0))`.execute(tx);
      return fn(tx);
    });
  }

  async insert(values: NewFile, db: RepoDb = this.db()): Promise<FileRow> {
    const rows = await db.insertInto('files').values(fileInsertValues(values)).returning(FILE_COLUMNS).execute();
    return rows[0]!;
  }

  async getById(id: string, db: RepoDb = this.db()): Promise<FileRow | undefined> {
    return db.selectFrom('files').select(FILE_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async contentBankTenant(itemId: string): Promise<string | undefined> {
    const row = await this.db().selectFrom('content_bank_content').select('tenant_id').where('id', '=', itemId).executeTakeFirst();
    return row?.tenant_id;
  }

  async getContextTenantId(contextId: string, db: RepoDb = this.db()): Promise<string | null | undefined> {
    const context = await db.selectFrom('context')
      .select(['context_level', 'instance_id', 'path'])
      .where('id', '=', contextId).executeTakeFirst();
    if (!context) return undefined;
    if (context.context_level === 20) return context.instance_id ?? undefined;
    const pathIds = context.path.split('/').filter(Boolean);
    if (!pathIds.length) return null;
    const owner = await db.selectFrom('context').select('instance_id')
      .where('id', 'in', pathIds).where('context_level', '=', 20)
      .executeTakeFirst();
    return owner?.instance_id ?? null;
  }

  async deleteById(id: string, db: RepoDb = this.db()): Promise<void> {
    await db.deleteFrom('files').where('id', '=', id).execute();
  }

  async countByHash(contentHash: string, storageDomain: string, db: RepoDb = this.db()): Promise<number> {
    const row = await db
      .selectFrom('files')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('content_hash', '=', contentHash)
      .where('storage_domain', '=', storageDomain)
      .executeTakeFirst();
    return row?.n ?? 0;
  }

  async listByContext(contextId: string, db: RepoDb = this.db()): Promise<FileRow[]> {
    return db
      .selectFrom('files')
      .select(FILE_COLUMNS)
      .where('context_id', '=', contextId)
      .orderBy('id', 'asc')
      .execute();
  }

  async listExamSnapshotFiles(itemId: string, db: RepoDb = this.db()): Promise<FileRow[]> {
    return db.selectFrom('files').select(FILE_COLUMNS)
      .where('item_id', '=', itemId).where('component', '=', 'question')
      .where('file_area', '=', 'exam_snapshot').orderBy('id', 'asc').execute();
  }

  async listSubmissionLinks(fileId: string, db: RepoDb = this.db()): Promise<LinkedSubmissionRow[]> {
    return db
      .selectFrom('assign_submission_files')
      .innerJoin('assign_submissions', 'assign_submission_files.submission_id', 'assign_submissions.id')
      .select(LINKED_SUBMISSION_COLUMNS)
      .where('assign_submission_files.file_id', '=', fileId)
      .execute();
  }

  async getSubmission(submissionId: string, db: RepoDb = this.db()): Promise<LinkedSubmissionRow | undefined> {
    return db
      .selectFrom('assign_submissions')
      .select(LINKED_SUBMISSION_COLUMNS)
      .where('assign_submissions.id', '=', submissionId)
      .limit(1)
      .executeTakeFirst();
  }

  async getGradeForSubmission(
    assignmentId: string,
    userId: string,
    db: RepoDb = this.db(),
  ): Promise<{ status: string; attemptNumber: number } | undefined> {
    return db
      .selectFrom('assign_grades')
      .select(['status', 'attempt_number as attemptNumber'])
      .where('assignment_id', '=', assignmentId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }
}
