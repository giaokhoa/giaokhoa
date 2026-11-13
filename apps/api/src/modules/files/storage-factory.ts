import type { ConfigService } from '@nestjs/config';
import { LocalObjectStorage, type ObjectStorage } from './storage';
import { S3ObjectStorage } from './storage-s3';

export function createObjectStorage(config: ConfigService): ObjectStorage {
  const driver = (config.get<string>('FILE_STORAGE_DRIVER') ?? 'local').trim().toLowerCase();
  switch (driver) {
    case 'local': return new LocalObjectStorage(config);
    case 's3': return new S3ObjectStorage(config);
    default: throw new Error(`Unknown FILE_STORAGE_DRIVER "${driver}" — expected "local" or "s3"`);
  }
}
