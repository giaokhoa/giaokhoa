import type { ImageStorage } from '@giaokhoa/application/images/storage';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

@Injectable()
export class S3ImageStorage implements ImageStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });

    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string) {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      body: object.Body ? new Uint8Array(await object.Body.transformToByteArray()) : undefined,
      etag: object.ETag,
    };
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
