import 'dotenv/config';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL phải được cấu hình.');
}

const database = new URL(databaseUrl);
const databaseClient = new Client({ connectionString: databaseUrl });
const databaseHost = databaseClient.connectionParameters.host;
const localDatabaseHosts = new Set(['db', 'postgres', 'localhost', '127.0.0.1', '::1']);
if (!localDatabaseHosts.has(databaseHost)) {
  throw new Error(`Từ chối reset database không phải local: ${databaseHost}`);
}

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
if (!endpoint || !bucket) {
  throw new Error('S3_ENDPOINT và S3_BUCKET phải được cấu hình.');
}

const s3Endpoint = new URL(endpoint);
const localS3Hosts = new Set(['s3mock', 'localhost', '127.0.0.1', '::1']);
if (!localS3Hosts.has(s3Endpoint.hostname)) {
  throw new Error(`Từ chối reset S3Mock trên endpoint không local: ${endpoint}`);
}

async function resetDatabase() {
  await databaseClient.connect();

  try {
    await databaseClient.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await databaseClient.query('DROP SCHEMA IF EXISTS public CASCADE');
    await databaseClient.query('CREATE SCHEMA public');
  } finally {
    await databaseClient.end();
  }

  console.log(`Đã reset database local ${database.pathname.slice(1)}.`);
}

async function migrateDatabase() {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--filter', '@giaokhoa/database', 'db:migrate'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Migration thất bại (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function resetS3Mock() {
  const client = new S3Client({
    endpoint,
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

  const objects = [];
  let continuationToken;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of page.Contents ?? []) {
      if (object.Key) objects.push(object.Key);
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  for (let index = 0; index < objects.length; index += 1000) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.slice(index, index + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  const remaining = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if ((remaining.Contents?.length ?? 0) > 0) {
    throw new Error('Reset S3Mock chưa sạch.');
  }

  console.log(`Đã reset S3Mock bucket ${bucket} (${objects.length} object(s)).`);
}

await resetDatabase();
await migrateDatabase();
await resetS3Mock();
