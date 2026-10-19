import 'dotenv/config';
import { ImagesService } from '@giaokhoa/application/images/service';
import { PostgresImagesRepository } from '@giaokhoa/database/images';
import * as schema from '@giaokhoa/database/schema';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { S3ImageStorage } from '../dist/images/s3-image-storage.js';

const ttlHours = Number(process.env.IMAGE_ORPHAN_TTL_HOURS ?? '24');
if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
  throw new Error('IMAGE_ORPHAN_TTL_HOURS phải là số dương');
}

const connectionString = process.env.DATABASE_URL;
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? 'us-east-1';
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

if (!connectionString) throw new Error('Thiếu DATABASE_URL');
if (!bucket) throw new Error('Thiếu S3_BUCKET');

const client = new pg.Client({ connectionString });
const storage = new S3ImageStorage(
  new ConfigService({
    S3_BUCKET: bucket,
    S3_REGION: region,
    S3_ENDPOINT: endpoint,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
  }),
);
const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

await client.connect();
try {
  const repository = new PostgresImagesRepository(drizzle(client, { schema }));
  const service = new ImagesService(repository, storage);
  const deletedObjects = await service.collectOrphanImages(cutoff);
  console.log(
    `Deleted ${deletedObjects} storage object(s), including pending retries and orphan images older than ${ttlHours}h.`,
  );
} finally {
  await client.end();
}
