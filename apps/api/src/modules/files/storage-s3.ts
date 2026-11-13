import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentKey, type ObjectStorage, type PresignedDownloadStorage } from './storage';
import { assertFileStorageDomain } from '@giaokhoa/db';

@Injectable()
export class S3ObjectStorage implements ObjectStorage, PresignedDownloadStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService, client?: S3Client) {
    const bucket = config.get<string>('FILE_STORAGE_S3_BUCKET');
    const accessKeyId = config.get<string>('FILE_STORAGE_S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('FILE_STORAGE_S3_SECRET_ACCESS_KEY');
    const missing = [
      ['FILE_STORAGE_S3_BUCKET', bucket],
      ['FILE_STORAGE_S3_ACCESS_KEY_ID', accessKeyId],
      ['FILE_STORAGE_S3_SECRET_ACCESS_KEY', secretAccessKey],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`FILE_STORAGE_DRIVER=s3 requires env: ${missing.join(', ')}`);
    }
    this.bucket = bucket as string;
    if (client) {
      this.client = client;
    } else {
      const endpoint = config.get<string>('FILE_STORAGE_S3_ENDPOINT');
      const forcePathStyleRaw = config.get<string | boolean>('FILE_STORAGE_S3_FORCE_PATH_STYLE');
      this.client = new S3Client({
        region: config.get<string>('FILE_STORAGE_S3_REGION') ?? 'us-east-1',
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle: forcePathStyleRaw === true || forcePathStyleRaw === 'true',
        credentials: { accessKeyId: accessKeyId as string, secretAccessKey: secretAccessKey as string },
      });
    }
  }

  keyFor(domain: string, contentHash: string): string { return contentKey(domain, contentHash); }

  async exists(domain: string, contentHash: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.keyFor(domain, contentHash) }));
      return true;
    } catch (err) {
      if (isS3NotFound(err)) return false;
      throw err;
    }
  }

  async put(domain: string, contentHash: string, data: Buffer): Promise<void> {
    assertFileStorageDomain(domain);
    if (await this.exists(domain, contentHash)) return;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.keyFor(domain, contentHash), Body: data }));
  }

  async get(domain: string, contentHash: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(domain, contentHash) }));
    if (!res.Body) throw new Error(`S3 object body missing for key ${this.keyFor(domain, contentHash)}`);
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(domain: string, contentHash: string): Promise<void> {
    assertFileStorageDomain(domain);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.keyFor(domain, contentHash) }));
  }

  async presignGetUrl(domain: string, contentHash: string, expiresInSeconds: number, opts?: { fileName?: string; mimeType?: string }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.keyFor(domain, contentHash),
      ...(opts?.fileName ? { ResponseContentDisposition: `attachment; filename="${opts.fileName.replace(/"/g, '')}"` } : {}),
      ...(opts?.mimeType ? { ResponseContentType: opts.mimeType } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

function isS3NotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey';
}
