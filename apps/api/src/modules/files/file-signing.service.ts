import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OBJECT_STORAGE, supportsPresignedDownloads, type ObjectStorage } from './storage';

@Injectable()
export class FileSigningService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  constructor(
    config: ConfigService,
    @Optional() @Inject(OBJECT_STORAGE) private readonly storage?: ObjectStorage,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
    this.ttlSeconds = config.get<number>('FILE_SIGNED_URL_TTL_SECONDS') ?? 300;
  }
  sign(fileId: string, domain: string): { token: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const mac = createHmac('sha256', this.secret).update(`${domain}.${fileId}.${expiresAt}`).digest('base64url');
    return { token: `${expiresAt}.${mac}`, expiresAt };
  }
  async createDownloadTarget(file: { id: string; storageDomain: string; signingDomain?: string; contentHash: string; fileName: string; mimeType?: string | null }): Promise<{ url: string; expiresAt: number }> {
    if (this.storage && supportsPresignedDownloads(this.storage)) {
      const url = await this.storage.presignGetUrl(file.storageDomain, file.contentHash, this.ttlSeconds, {
        fileName: file.fileName, mimeType: file.mimeType ?? undefined,
      });
      return { url, expiresAt: Math.floor(Date.now() / 1000) + this.ttlSeconds };
    }
    const { token, expiresAt } = this.sign(file.id, file.signingDomain ?? file.storageDomain);
    return { url: `/api/v1/files/${file.id}/download?sig=${encodeURIComponent(token)}`, expiresAt };
  }
  verify(fileId: string, domain: string, token: string | undefined): void {
    if (!token) throw new UnauthorizedException({ message: 'Missing file signature', code: 'file.signature_missing' });
    const [expRaw, mac] = token.split('.');
    const expiresAt = Number(expRaw);
    if (!mac || Number.isNaN(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException({ message: 'File signature expired or invalid', code: 'file.signature_invalid' });
    }
    const expected = createHmac('sha256', this.secret).update(`${domain}.${fileId}.${expiresAt}`).digest('base64url');
    const a = Buffer.from(mac); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException({ message: 'File signature expired or invalid', code: 'file.signature_invalid' });
    }
  }
}
