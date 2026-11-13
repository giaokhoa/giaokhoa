import type { CentreDb } from '../client';

export interface SystemMaterialReference {
  materialId: string;
  version: number;
  checksum: string;
}

export class SystemMaterialReferencesRepository {
  constructor(private readonly db: CentreDb) {}

  async get(resourceId: string): Promise<SystemMaterialReference | null> {
    const row = await this.db.selectFrom('resources').select([
      'system_material_id as materialId', 'system_material_version as version', 'system_material_checksum as checksum',
    ]).where('id', '=', resourceId).executeTakeFirst();
    return row?.materialId && row.version && row.checksum ? { materialId: row.materialId, version: row.version, checksum: row.checksum } : null;
  }

  async insert(courseId: string, name: string, reference: SystemMaterialReference): Promise<string> {
    const row = await this.db.insertInto('resources').values({
      course: courseId, name, kind: 'file',
      system_material_id: reference.materialId, system_material_version: reference.version, system_material_checksum: reference.checksum,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async attach(resourceId: string, cmId: string): Promise<void> {
    await this.db.updateTable('resources').set({ cm_id: cmId }).where('id', '=', resourceId).execute();
  }

  async remove(resourceId: string): Promise<void> {
    await this.db.deleteFrom('resources').where('id', '=', resourceId).execute();
  }
}
