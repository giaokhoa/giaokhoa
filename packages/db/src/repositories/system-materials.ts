import { sql } from 'kysely';
import type { SystemMaterialPackage, SystemMaterialSubmission, SystemMaterialVersion } from '@giaokhoa/contracts';
import type { SystemBankDb } from '../client';

const SUBMISSION_COLUMNS = [
  'id', 'centre_slug as centreSlug', 'source_content_id as sourceContentId',
  'source_revision as sourceRevision', 'package', 'checksum', 'status',
  'rejection_reason as rejectionReason', 'published_material_id as publishedMaterialId',
  'published_version as publishedVersion',
] as const;

export class SystemMaterialsRepository {
  constructor(private readonly handle: SystemBankDb | null, private readonly notConfigured: () => Error) {}

  private db(): SystemBankDb {
    if (!this.handle) throw this.notConfigured();
    return this.handle;
  }

  async submit(actorId: string, pkg: SystemMaterialPackage, checksum: string): Promise<SystemMaterialSubmission> {
    return this.db().transaction().execute(async (tx) => {
      const existing = await tx.selectFrom('system_materials').select('status')
        .where('centre_slug', '=', pkg.source.centreSlug)
        .where('source_content_id', '=', pkg.source.contentId).executeTakeFirst();
      if (existing?.status === 'withdrawn') throw new Error('system_material.source_withdrawn');
      const inserted = await tx.insertInto('system_material_submissions').values({
        centre_slug: pkg.source.centreSlug, source_content_id: pkg.source.contentId,
        source_revision: checksum, checksum, status: 'pending', package: sql`${JSON.stringify(pkg)}::jsonb`, submitted_by: actorId,
      }).onConflict((oc) => oc.columns(['centre_slug', 'source_content_id', 'source_revision']).doNothing())
        .returning(SUBMISSION_COLUMNS).executeTakeFirst();
      return inserted ?? tx.selectFrom('system_material_submissions').select(SUBMISSION_COLUMNS)
        .where('centre_slug', '=', pkg.source.centreSlug).where('source_content_id', '=', pkg.source.contentId)
        .where('source_revision', '=', checksum).executeTakeFirstOrThrow();
    });
  }

  async submissions(centreSlug?: string): Promise<SystemMaterialSubmission[]> {
    let query = this.db().selectFrom('system_material_submissions').select(SUBMISSION_COLUMNS);
    query = centreSlug ? query.where('centre_slug', '=', centreSlug) : query.where('status', '=', 'pending');
    return query.orderBy('created_at', 'desc').execute();
  }

  async submission(id: string): Promise<SystemMaterialSubmission | undefined> {
    return this.db().selectFrom('system_material_submissions').select(SUBMISSION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async review(id: string, actorId: string, reason?: string): Promise<SystemMaterialSubmission | undefined> {
    return this.db().transaction().execute(async (tx) => {
      const row = await tx.selectFrom('system_material_submissions').select(SUBMISSION_COLUMNS)
        .where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row || row.status !== 'pending') return row;
      const decision = { reviewed_by: actorId, reviewed_at: new Date() };
      if (reason) {
        return tx.updateTable('system_material_submissions').set({ ...decision, status: 'rejected', rejection_reason: reason })
          .where('id', '=', id).returning(SUBMISSION_COLUMNS).executeTakeFirstOrThrow();
      }
      await sql`select pg_advisory_xact_lock(hashtextextended(${'material/' + row.centreSlug + '/' + row.sourceContentId}, 0))`.execute(tx);
      const material = await tx.insertInto('system_materials').values({
        centre_slug: row.centreSlug, source_content_id: row.sourceContentId,
      }).onConflict((oc) => oc.columns(['centre_slug', 'source_content_id']).doNothing()).returning('id').executeTakeFirst()
        ?? await tx.selectFrom('system_materials').select('id').where('centre_slug', '=', row.centreSlug)
          .where('source_content_id', '=', row.sourceContentId).executeTakeFirstOrThrow();
      const active = await tx.selectFrom('system_materials').select('status')
        .where('id', '=', material.id).forUpdate().executeTakeFirstOrThrow();
      if (active.status === 'withdrawn') throw new Error('system_material.source_withdrawn');
      const latest = await tx.selectFrom('system_material_versions').select('version')
        .where('material_id', '=', material.id).orderBy('version', 'desc').executeTakeFirst();
      const version = (latest?.version ?? 0) + 1;
      await tx.insertInto('system_material_versions').values({
        material_id: material.id, version, package: sql`${JSON.stringify(row.package)}::jsonb`, checksum: row.checksum,
      }).execute();
      await tx.insertInto('system_bank_events').values({
        type: 'material_version_published', resource_kind: 'material', resource_key: material.id,
        payload: sql`${JSON.stringify({ materialId: material.id, version, checksum: row.checksum })}::jsonb`,
      }).execute();
      return tx.updateTable('system_material_submissions').set({
        ...decision, status: 'approved', published_material_id: material.id, published_version: version,
      }).where('id', '=', id).returning(SUBMISSION_COLUMNS).executeTakeFirstOrThrow();
    });
  }

  async status(materialId: string): Promise<'published' | 'withdrawn' | null> {
    const row = await this.db().selectFrom('system_materials').select('status')
      .where('id', '=', materialId).executeTakeFirst();
    return (row?.status as 'published' | 'withdrawn' | undefined) ?? null;
  }

  async latestVersion(materialId: string): Promise<number | null> {
    const row = await this.db().selectFrom('system_material_versions').select('version')
      .where('material_id', '=', materialId).orderBy('version', 'desc').executeTakeFirst();
    return row?.version ?? null;
  }

  async withdraw(materialId: string, reason: string): Promise<{ materialId: string; status: string } | null> {
    return this.db().transaction().execute(async (tx) => {
      const row = await tx.selectFrom('system_materials').select(['id', 'status'])
        .where('id', '=', materialId).forUpdate().executeTakeFirst();
      if (!row || row.status !== 'published') return null;
      await tx.updateTable('system_materials').set({
        status: 'withdrawn', withdrawn_at: new Date(), withdrawn_reason: reason,
      }).where('id', '=', materialId).execute();
      await tx.insertInto('system_bank_events').values({
        type: 'material_withdrawn', resource_kind: 'material', resource_key: materialId,
        payload: sql`${JSON.stringify({ materialId, reason })}::jsonb`,
      }).execute();
      return { materialId, status: 'withdrawn' };
    });
  }

  async discover(): Promise<SystemMaterialVersion[]> {
    return this.db().selectFrom('system_material_versions')
      .innerJoin('system_materials', 'system_materials.id', 'system_material_versions.material_id')
      .select([
        'system_material_versions.material_id as materialId',
        'system_material_versions.version as version',
        'system_material_versions.checksum as checksum',
        'system_material_versions.package as package',
      ]).where('system_materials.status', '=', 'published')
      .orderBy('system_material_versions.created_at', 'desc').execute();
  }

  async version(materialId: string, version: number): Promise<SystemMaterialVersion | undefined> {
    return this.db().selectFrom('system_material_versions').select([
      'material_id as materialId', 'version', 'checksum', 'package',
    ]).where('material_id', '=', materialId).where('version', '=', version).executeTakeFirst();
  }
}
