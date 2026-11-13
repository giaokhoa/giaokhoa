/**
 * Bản tiếp nhận học liệu nằm ngay trên resources của trung tâm, giữ tenant/RLS
 * hiện hữu. Chỉ lưu id/version/checksum công bố, không sao nội dung để biên tập.
 * Handle routed do ứng dụng cấp; không mở giao dịch xuyên kho ngân hàng.
 */
import type { CentreDb } from '../client';

/** Dấu vết phiên bản ghim vào một tài nguyên của khoá. */
export interface SystemMaterialReference {
  materialId: string;
  version: number;
  checksum: string;
}

/** Đọc/ghi dấu tiếp nhận bằng handle trung tâm, giữ quyền khoá cho tầng service. */
export class SystemMaterialReferencesRepository {
  constructor(private readonly db: CentreDb) {}

  /** Đọc pin dưới RLS của resources; không có pin thì dùng đường học liệu thường. */
  async get(resourceId: string): Promise<SystemMaterialReference | null> {
    const row = await this.db.selectFrom('resources').select([
      'system_material_id as materialId', 'system_material_version as version', 'system_material_checksum as checksum',
    ]).where('id', '=', resourceId).executeTakeFirst();
    return row?.materialId && row.version && row.checksum ? { materialId: row.materialId, version: row.version, checksum: row.checksum } : null;
  }

  /** Tạo vỏ mod_resource ghim phiên bản ngay lần ghi đầu, không có fileId/URL nguồn riêng. */
  async insert(courseId: string, name: string, reference: SystemMaterialReference): Promise<string> {
    const row = await this.db.insertInto('resources').values({
      course: courseId, name, kind: 'file',
      system_material_id: reference.materialId, system_material_version: reference.version, system_material_checksum: reference.checksum,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  /** Gắn module sau khi CoursesService đã tạo context và phát sự kiện đúng pattern hiện hữu. */
  async attach(resourceId: string, cmId: string): Promise<void> {
    await this.db.updateTable('resources').set({ cm_id: cmId }).where('id', '=', resourceId).execute();
  }

  /** Bù vỏ tài nguyên nếu tạo module thất bại, không tác động tới phiên bản ngân hàng. */
  async remove(resourceId: string): Promise<void> {
    await this.db.deleteFrom('resources').where('id', '=', resourceId).execute();
  }
}
