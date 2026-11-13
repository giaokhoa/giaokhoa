/**
 * Worker tiêu thụ job cleanup-orphan từ FilesService.
 * Job phải mang miền sở hữu; worker đối chiếu miền với ID sổ đăng ký,
 * đếm tham chiếu trong đúng database rồi xoá key của đúng miền.
 * Job thiếu/sai miền không bao giờ được suy đoán hay xoá byte.
 */
import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Job } from 'bullmq';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertFileStorageDomain, fileContentKey, fileDomainForSpace, sql, SYSTEM_FILE_DOMAIN,
} from '@giaokhoa/db';
import { tenantAls } from '../db/tenant-als';
import { SpaceDatabaseService } from '../db/routing/space-database.service';

/** Payload có miền bắt buộc, slug là định danh định tuyến cho database của miền. */
export interface FileCleanupJobData {
  contentHash: string;
  storageDomain: string;
  spaceSlug?: string;
}

/** Kết quả được ghi kèm miền để đối chiếu và kiểm toán. */
export interface FileCleanupResult {
  contentHash: string;
  storageDomain: string;
  removed: boolean;
  refcount: number;
}

/** Dọn byte theo miền sở hữu sau khi kiểm tra lại tham chiếu thật. */
@Processor('file-cleanup')
export class FileCleanupProcessor extends ObservedWorkerHost {
  private readonly logger = new Logger(FileCleanupProcessor.name);
  private s3?: S3Client;

  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly config: ConfigService,
  ) { super(); }

  /**
   * Chặn job thiếu miền, miền sai hoặc không khớp sổ trước khi mở kho
   * dữ liệu hay xoá vật lý. Không chấp nhận miền legacy vì không di trú file cũ.
   */
  async process(job: Job<FileCleanupJobData>): Promise<FileCleanupResult> {
    const data = job.data;
    if (!data || typeof data.storageDomain !== 'string' || typeof data.contentHash !== 'string') {
      throw new Error('file.cleanup_domain_required');
    }
    assertFileStorageDomain(data.storageDomain);
    fileContentKey(data.storageDomain, data.contentHash);
    const slug = data.spaceSlug;
    if (data.storageDomain === SYSTEM_FILE_DOMAIN) {
      if (slug) throw new Error('file.cleanup_domain_mismatch');
      return tenantAls.run({ platform: true }, async () => this.processInContext(data));
    }
    if (!slug || typeof slug !== 'string') throw new Error('file.cleanup_space_required');

    // Định danh sổ đăng ký là nguồn sự thật của miền, không tin giá trị trong job.
    const target = await this.spaceDb.resolveTarget(slug);
    if (fileDomainForSpace(target.spaceId) !== data.storageDomain) {
      throw new Error('file.cleanup_domain_mismatch');
    }
    return tenantAls.run({ platform: true }, async () =>
      this.spaceDb.withSpaceKysely(slug, async () => this.processInContext(data)),
    );
  }

  /** Kiểm tham chiếu trong đúng handle của kho đích ngay trước khi xoá byte. */
  private async processInContext(data: FileCleanupJobData): Promise<FileCleanupResult> {
    const { contentHash, storageDomain } = data;
    const row = await this.spaceDb.routedKysely.selectFrom('files')
      .select(sql.raw<number>('count(*)::int').as('n'))
      .where('content_hash', '=', contentHash)
      .where('storage_domain', '=', storageDomain)
      .executeTakeFirst();
    const refcount = row?.n ?? 0;
    if (refcount > 0) {
      this.logger.log('File cleanup kept referenced object in '+storageDomain);
      return { contentHash, storageDomain, removed: false, refcount };
    }
    await this.removePhysicalObject(storageDomain, contentHash);
    this.logger.log('File cleanup removed orphan object in '+storageDomain);
    return { contentHash, storageDomain, removed: true, refcount: 0 };
  }

  /**
   * Driver trùng cấu hình API: local xoá đường dẫn đã kiểm định; S3 gửi
   * DeleteObject tới cùng bucket/key; lỗi truyền ra để BullMQ retry.
   */
  private async removePhysicalObject(domain: string, hash: string): Promise<void> {
    const key = fileContentKey(domain, hash);
    const driver = this.config.get<string>('FILE_STORAGE_DRIVER') ?? 'local';
    if (driver === 'local') {
      const root = this.config.get<string>('FILE_STORAGE_DIR') ?? './data/files';
      await rm(join(root, key), { force: true });
      return;
    }
    if (driver !== 's3') throw new Error('file.cleanup_driver_unknown');
    const bucket = this.config.get<string>('FILE_STORAGE_S3_BUCKET');
    if (!bucket) throw new Error('file.cleanup_bucket_required');
    await this.s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** Khởi tạo lười SDK với đúng endpoint và danh tính của API. */
  private s3Client(): S3Client {
    if (this.s3) return this.s3;
    const accessKeyId = this.config.get<string>('FILE_STORAGE_S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('FILE_STORAGE_S3_SECRET_ACCESS_KEY');
    if (!accessKeyId || !secretAccessKey) throw new Error('file.cleanup_credentials_required');
    const endpoint = this.config.get<string>('FILE_STORAGE_S3_ENDPOINT');
    const forcePathStyle = this.config.get<string | boolean>('FILE_STORAGE_S3_FORCE_PATH_STYLE');
    this.s3 = new S3Client({
      region: this.config.get<string>('FILE_STORAGE_S3_REGION') ?? 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: forcePathStyle === true || forcePathStyle === 'true',
      credentials: { accessKeyId, secretAccessKey },
    });
    return this.s3;
  }
}
