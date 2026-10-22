import 'dotenv/config';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const { S3_ENDPOINT, S3_BUCKET } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET) throw new Error('Thiếu cấu hình S3Mock.');
const endpoint = new URL(S3_ENDPOINT);
if (!['s3mock', 'localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
  throw new Error('Từ chối reset S3 không phải local.');

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

try {
  let removed = 0;
  for (;;) {
    const { Contents = [] } = await client.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, MaxKeys: 1000 }),
    );
    if (!Contents.length) break;
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: Contents.map(({ Key }) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors?.length)
      throw new Error(`Không thể xóa ${result.Errors.length} object S3Mock.`);
    removed += Contents.length;
  }
  console.log(`Đã reset S3Mock bucket ${S3_BUCKET} (${removed} object).`);
} finally {
  client.destroy();
}
