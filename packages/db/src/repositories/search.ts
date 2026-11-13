import { sql, type Insertable, type Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

export type SearchDb = CentreDb | CentreTx;

export interface SearchDocRow {
  id: string;
  area: string;
  itemId: string;
  contextId: string;
  title: string;
  content: string;
  ownerId: string | null;
  updatedAt: Date;
}

export interface NewSearchDoc {
  id?: string;
  area: string;
  itemId: string;
  contextId: string;
  title?: string;
  content?: string;
  ownerId?: string | null;
  updatedAt?: Date;
}

const SEARCH_DOC_COLUMNS = [
  'id',
  'area',
  'item_id as itemId',
  'context_id as contextId',
  'title',
  'content',
  'owner_id as ownerId',
  'updated_at as updatedAt',
] as const;

function searchDocInsertValues(values: NewSearchDoc): Insertable<CentreDB['search_documents']> {
  const row: Insertable<CentreDB['search_documents']> = {
    area: values.area,
    item_id: values.itemId,
    context_id: values.contextId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.title !== undefined) row.title = values.title;
  if (values.content !== undefined) row.content = values.content;
  if (values.ownerId !== undefined) row.owner_id = values.ownerId;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

export class SearchRepository {
  constructor(private readonly handle: CentreDb) {}

  get dbHandle(): CentreDb {
    return this.handle;
  }

  async upsert(v: NewSearchDoc, db: SearchDb = this.handle): Promise<SearchDocRow> {
    const conflictSet: Updateable<CentreDB['search_documents']> = {
      context_id: v.contextId,
      owner_id: v.ownerId ?? null,
      updated_at: new Date(),
    };
    if (v.title !== undefined) conflictSet.title = v.title;
    if (v.content !== undefined) conflictSet.content = v.content;
    const rows = await db
      .insertInto('search_documents')
      .values(searchDocInsertValues(v))
      .onConflict((oc) => oc.columns(['area', 'item_id']).doUpdateSet(conflictSet))
      .returning(SEARCH_DOC_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async remove(area: string, itemId: string, db: SearchDb = this.handle): Promise<void> {
    await db
      .deleteFrom('search_documents')
      .where('area', '=', area)
      .where('item_id', '=', itemId)
      .execute();
  }

  async removeByOwner(ownerId: string, db: SearchDb = this.handle): Promise<void> {
    await db
      .deleteFrom('search_documents')
      .where('owner_id', '=', ownerId)
      .execute();
  }

  async get(area: string, itemId: string, db: SearchDb = this.handle): Promise<SearchDocRow | undefined> {
    return db
      .selectFrom('search_documents')
      .select(SEARCH_DOC_COLUMNS)
      .where('area', '=', area)
      .where('item_id', '=', itemId)
      .executeTakeFirst();
  }

  async listAll(db: SearchDb = this.handle): Promise<SearchDocRow[]> {
    return db.selectFrom('search_documents').select(SEARCH_DOC_COLUMNS).execute();
  }

  async countAll(db: SearchDb = this.handle): Promise<number> {
    const row = await db
      .selectFrom('search_documents')
      .select(sql<number>`count(*)::int`.as('total'))
      .executeTakeFirst();
    return row?.total ?? 0;
  }

  async queryEngine(q: string, db: SearchDb = this.handle): Promise<SearchDocRow[]> {
    if (!q.trim()) return [];
    const res = await sql<SearchDocRow>`select id, area, item_id as "itemId", title, content, context_id as "contextId", owner_id as "ownerId", updated_at as "updatedAt" from search_documents where to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', ${q}) order by id`
      .execute(db);
    return res.rows;
  }

  async matchesContent(title: string, content: string, q: string, db: SearchDb = this.handle): Promise<boolean> {
    if (!q.trim()) return false;
    const res = await sql<{ matched: boolean }>`select (to_tsvector('simple', ${title} || ' ' || ${content}) @@ plainto_tsquery('simple', ${q})) as matched`
      .execute(db);
    return res.rows[0]?.matched === true;
  }
}
