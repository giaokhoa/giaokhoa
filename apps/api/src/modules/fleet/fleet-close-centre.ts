/**
 * Kết thúc vòng đời một trung tâm có database/miền file riêng.
 * Chỉ CLI vận hành mới có quyền huỷ vật lý: kiểm ID không gian,
 * bản sao lưu trọn vẹn, chuyển status sang closed để chặn phiên/job,
 * vô hiệu login role riêng, huỷ database rồi xoá chính prefix file
 * của trung tâm. Có thể gọi lại khi lần dọn trước bị gián đoạn.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Client } from 'pg';
import { fileDomainForSpace } from '@giaokhoa/db';
import { quoteIdentifier } from '../control-plane/control-plane-provision';
import { FleetRegistryWriter } from './fleet-registry-writer';
import { parseBackupFileName, retargetUrl } from './fleet-common';
import { readVerifiedSpaceArchive } from './fleet-space-archive';

export type CloseCentreOptions = {
  slug: string;
  expectedSpaceId: string;
  actorId: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

/** Chọn bản sao lưu mới nhất, yêu cầu đủ dump/manifest/file được kiểm hash. */
function latestBackup(dir: string): string {
  const latest = readdirSync(dir)
    .filter((name) => parseBackupFileName(name))
    .map((name) => ({ name, modified: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified)[0];
  if (!latest) throw new Error('no complete centre backup exists');
  return join(dir, latest.name);
}

/** Chỉ xoá dữ liệu trong prefix được tính từ UUID sổ của A, không liệt kê B. */
async function purgeCentreFiles(spaceId: string, env: NodeJS.ProcessEnv): Promise<number> {
  const domain = fileDomainForSpace(spaceId);
  const driver = env.FILE_STORAGE_DRIVER ?? 'local';
  if (driver === 'local') {
    const root = resolve(env.FILE_STORAGE_DIR ?? './data/files');
    if (root === '/') throw new Error('refusing to purge from the filesystem root');
    if (!existsSync(root)) return 0;
    const target = join(root, domain);
    if (!existsSync(target)) return 0;
    rmSync(target, { recursive: true, force: true });
    return 1;
  }
  if (driver !== 's3') throw new Error('unknown FILE_STORAGE_DRIVER');
  const bucket = env.FILE_STORAGE_S3_BUCKET;
  const accessKeyId = env.FILE_STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.FILE_STORAGE_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error('S3 storage credentials or bucket missing');
  const client = new S3Client({
    region: env.FILE_STORAGE_S3_REGION ?? 'us-east-1',
    ...(env.FILE_STORAGE_S3_ENDPOINT ? { endpoint: env.FILE_STORAGE_S3_ENDPOINT } : {}),
    forcePathStyle: env.FILE_STORAGE_S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId, secretAccessKey },
  });
  let count = 0;
  try {
    // Luôn đọc trang đầu sau khi xoá. Token phân trang có thể
    // hết hiệu lực khi các object của trang vừa đọc bị huỷ.
    for (;;) {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: domain + '/',
          MaxKeys: 1000,
        }),
      );
      const objects = (listed.Contents ?? []).flatMap((entry) =>
        entry.Key?.startsWith(domain + '/') ? [{ Key: entry.Key }] : [],
      );
      if (objects.length === 0) break;
      const deleted = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
      if (deleted.Errors?.length) throw new Error('S3 centre purge failed for one or more objects');
      count += objects.length;
    }
  } finally {
    client.destroy();
  }
  return count;
}

/**
 * Đóng trung tâm sau khi xác thực đủ bản chụp độc lập.
 * @throws Error nếu định danh sai, kho là công cộng/ngân hàng/kho chung,
 * hoặc DB/role có chủ khác; lỗi cleanup giữ trạng thái closed để chạy lại.
 */
export async function runFleetCloseCentre(options: CloseCentreOptions): Promise<{
  slug: string;
  status: 'closed';
  purgedObjects: number;
}> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const adminUrl = env.DATABASE_ADMIN_URL;
  if (!adminUrl || !env.FLEET_BACKUP_DIR || !env.FLEET_BACKUP_ENCRYPTION_KEY) {
    throw new Error('DATABASE_ADMIN_URL, FLEET_BACKUP_DIR and FLEET_BACKUP_ENCRYPTION_KEY are required');
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!UUID.test(options.expectedSpaceId) || !UUID.test(options.actorId)) {
    throw new Error('space-id and actor-id must be UUIDs');
  }
  const writer = new FleetRegistryWriter(env);
  try {
    const spaces = await writer.listFleetSpaces();
    const space = spaces.find((entry) => entry.slug === options.slug);
    const registration = space ? await writer.findSpaceBySlug(space.slug) : undefined;
    if (
      !space ||
      !registration ||
      space.id !== options.expectedSpaceId ||
      space.kind !== 'center' ||
      registration.storageMode !== 'dedicated' ||
      !['suspended', 'closed'].includes(space.status)
    ) {
      throw new Error('centre identity, storage mode or lifecycle state is invalid');
    }
    if (
      spaces.some(
        (entry) =>
          entry.id !== space.id &&
          (entry.databaseName === space.databaseName || (registration.secretRef && entry.secretRef === space.secretRef)),
      )
    ) {
      throw new Error('centre database or secret is shared with another space');
    }
    for (const entry of spaces) {
      if (entry.id === space.id) continue;
      const other = await writer.findSpaceBySlug(entry.slug);
      if (other?.connectionRoleRef === registration.connectionRoleRef) {
        throw new Error('centre connection role is shared with another space');
      }
    }
    if (registration.connectionRoleRef === 'postgres') throw new Error('cannot revoke administrative role');

    // Không cho xoá nếu chưa có bản có thể giải mã và đối chiếu
    // cả DB lẫn file; lỗi manifest phải chặn trước cả đổi trạng thái.
    const backupPath = latestBackup(join(env.FLEET_BACKUP_DIR, space.slug));
    // Chỉ cho phép huỷ khi đã dừng traffic và có bản sao mới:
    // không dùng bản cũ từ nhiều ngày trước làm căn cứ xoá dữ liệu.
    if (space.status !== 'closed' && Date.now() - statSync(backupPath).mtimeMs > 60 * 60 * 1000) {
      throw new Error('centre backup is older than one hour; create a fresh backup before closing');
    }
    readVerifiedSpaceArchive(backupPath, space, env.FLEET_BACKUP_ENCRYPTION_KEY);

    if (space.status !== 'closed') {
      await writer.changeSpaceStatus(space.id, 'closed', options.actorId);
      log('Centre access revoked in control plane: ' + space.slug);
    }
    const admin = new Client({
      connectionString: retargetUrl(adminUrl, 'postgres'),
    });
    await admin.connect();
    try {
      // Chặn role trung tâm mở phiên mới, rồi đóng toàn bộ backend
      // còn sống trước khi huỷ DB; job retry không thể viết qua B.
      const role = await admin.query<{ rolname: string; rolsuper: boolean }>(
        'SELECT rolname, rolsuper FROM pg_roles WHERE rolname = $1',
        [registration.connectionRoleRef],
      );
      if (role.rows[0]?.rolsuper) throw new Error('cannot revoke superuser role');
      if (role.rows.length > 0) {
        await admin.query('ALTER ROLE ' + quoteIdentifier(registration.connectionRoleRef) + ' NOLOGIN');
      }
      const existingDb = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [space.databaseName]);
      if (existingDb.rowCount) {
        await admin.query('REVOKE CONNECT ON DATABASE ' + quoteIdentifier(space.databaseName) + ' FROM PUBLIC');
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [space.databaseName],
        );
        await admin.query('DROP DATABASE ' + quoteIdentifier(space.databaseName) + ' WITH (FORCE)');
      }
    } finally {
      await admin.end();
    }
    const purgedObjects = await purgeCentreFiles(space.id, env);
    log('Centre closed: ' + space.slug + '; objects purged: ' + purgedObjects);
    return { slug: space.slug, status: 'closed', purgedObjects };
  } finally {
    await writer.close();
  }
}

/** Gác ba định danh tường minh, không có chế độ xoá tất cả kho. */
if (require.main === module) {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) {
      console.error('Usage: fleet:close-centre --slug <slug> --space-id <uuid> --actor-id <uuid>');
      process.exit(1);
    }
    args.set(process.argv[i]!.slice(2), process.argv[i + 1]!);
  }
  runFleetCloseCentre({
    slug: args.get('slug') ?? '',
    expectedSpaceId: args.get('space-id') ?? '',
    actorId: args.get('actor-id') ?? '',
  }).catch((error: unknown) => {
    console.error('fleet close failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
