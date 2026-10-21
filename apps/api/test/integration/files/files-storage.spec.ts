import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { envSchema, type Env } from '../../../src/config/env.js';
import { S3FileStorage } from '../../../src/files/s3-file-storage.js';

describe('S3 FileStorage integration', () => {
  it('writes, reads and deletes an isolated object', async () => {
    const config = new ConfigService<Env, true>(envSchema.parse(process.env));
    const storage = new S3FileStorage(config);
    const key = `files/e2e/${randomUUID()}.png`;
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      await storage.put(key, bytes, 'image/png');
      const stored = await storage.get(key);
      expect(stored.body).toEqual(bytes);
      expect(stored.etag).toBeTruthy();
      await storage.delete(key);
      await expect(storage.get(key)).rejects.toThrow();
    } finally {
      await storage.delete(key);
    }
  });
});
