import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FilesService } from './files.service';

@Injectable()
export class FilesListener {
  private readonly logger = new Logger(FilesListener.name);
  constructor(private readonly files: FilesService) {}

  @OnEvent('cm_deleted')
  async onCmDeleted(payload: { cmId: string; contextId?: string | null }): Promise<void> {
    if (!payload.contextId) return;
    const records = await this.files.listByContext(payload.contextId);
    for (const record of records) await this.files.deleteFile(record.id);
    if (records.length) this.logger.log(`cm_deleted: removed ${records.length} file record(s) from context ${payload.contextId}`);
  }
}
