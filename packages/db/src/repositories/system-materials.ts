/**
 * Kho công bố học liệu trên handle bank-system do ứng dụng cấp.
 * Gửi idempotent theo revision; duyệt khoá nguồn và ghi phiên bản trong
 * một giao dịch duy nhất. Không truy cập khoá học hoặc hồ sơ người học.
 */
import { sql } from 'kysely';
import type { SystemMaterialPackage, SystemMaterialSubmission, SystemMaterialVersion } from '@giaokhoa/contracts';
import type { SystemBankDb } from '../client';

const SUBMISSION_COLUMNS = [
  'id', 'centre_slug as centreSlug', 'source_content_id as sourceContentId',
  'source_revision as sourceRevision', 'package', 'checksum', 'status',
  'rejection_reason as rejectionReason', 'published_material_id as publishedMaterialId',
  'published_version as publishedVersion',
] as const;

/** Repository không tự mở pool; handle null giữ khả năng khởi động khi ngân hàng chưa cấu hình. */
export class SystemMaterialsRepository {
  constructor(private readonly handle: SystemBankDb | null, private readonly notConfigured: () => Error) {}

  /** Mọi thao tác với kho chưa cấu hình đều dừng rõ ràng thay vì fallback vào trung tâm. */
  private db(): SystemBankDb {
    if (!this.handle) throw this.notConfigured();
    return this.handle;
  }

  /** Chụp một revision đúng một lần; retry trả lại package và quyết định ban đầu. */
  async submit(actorId: string, pkg: SystemMaterialPackage, checksum: string): Promise<SystemMaterialSubmission> {
    return this.db().transaction().execute(async (tx) => {
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

  /** Lịch sử theo trung tâm hoặc hàng chờ hệ thống; caller đã kiểm quyền đúng phạm vi. */
  async submissions(centreSlug?: string): Promise<SystemMaterialSubmission[]> {
    let query = this.db().selectFrom('system_material_submissions').select(SUBMISSION_COLUMNS);
    query = centreSlug ? query.where('centre_slug', '=', centreSlug) : query.where('status', '=', 'pending');
    return query.orderBy('created_at', 'desc').execute();
  }

  /** Lấy bản gửi cho cổng duyệt, không phải đường khám phá công khai. */
  async submission(id: string): Promise<SystemMaterialSubmission | undefined> {
    return this.db().selectFrom('system_material_submissions').select(SUBMISSION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  /**
   * Khoá bản gửi và nguồn trước khi quyết định. Hai lượt duyệt cùng lúc chỉ
   * phát hành một phiên bản; quyết định đã có không bị thay thế khi retry.
   */
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
      const latest = await tx.selectFrom('system_material_versions').select('version')
        .where('material_id', '=', material.id).orderBy('version', 'desc').executeTakeFirst();
      const version = (latest?.version ?? 0) + 1;
      await tx.insertInto('system_material_versions').values({
        material_id: material.id, version, package: sql`${JSON.stringify(row.package)}::jsonb`, checksum: row.checksum,
      }).execute();
      return tx.updateTable('system_material_submissions').set({
        ...decision, status: 'approved', published_material_id: material.id, published_version: version,
      }).where('id', '=', id).returning(SUBMISSION_COLUMNS).executeTakeFirstOrThrow();
    });
  }

  /** Liệt kê từng phiên bản đã duyệt để trung tâm chủ động chọn; không trả hàng chờ. */
  async discover(): Promise<SystemMaterialVersion[]> {
    return this.db().selectFrom('system_material_versions').select([
      'material_id as materialId', 'version', 'checksum', 'package',
    ]).orderBy('created_at', 'desc').execute();
  }

  /** Đọc chính xác phiên bản bất biến, kể cả khi nguồn đã bị xoá. */
  async version(materialId: string, version: number): Promise<SystemMaterialVersion | undefined> {
    return this.db().selectFrom('system_material_versions').select([
      'material_id as materialId', 'version', 'checksum', 'package',
    ]).where('material_id', '=', materialId).where('version', '=', version).executeTakeFirst();
  }
}
