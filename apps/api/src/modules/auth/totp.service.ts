import { Injectable } from '@nestjs/common';
import { badRequest, conflict, unauthorized } from '../../common/http-errors';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';

const TOTP_ISSUER = 'Giáo khoa';
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

@Injectable()
export class TotpService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly config: ConfigService,
  ) {}

  private encryptionKey(): Buffer {
    const material = this.config.get<string>('MFA_ENCRYPTION_KEY') ?? this.config.getOrThrow<string>('JWT_SECRET');
    return createHash('sha256').update(material).digest();
  }

  private encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  private decryptSecret(stored: string): string {
    const raw = Buffer.from(stored, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  async verifyCode(secret: string, code: string): Promise<boolean> {
    try {
      const result = await verify({ secret, token: code, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
      return result.valid;
    } catch {
      return false;
    }
  }

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.repo.getTotpByUserId(userId);
    return row?.confirmed === true;
  }

  async setup(userId: string, username: string, currentCode?: string): Promise<{ secret: string; otpauthUrl: string }> {
    const existing = await this.repo.getTotpByUserId(userId);
    if (existing?.confirmed) {
      if (!currentCode) {
        unauthorized('Current two-factor authentication code is required to replace the active authenticator', 'auth.mfa_reauth_required');
      }
      if (!(await this.verifyCode(this.decryptSecret(existing.secretEncrypted), currentCode))) {
        unauthorized('Invalid two-factor authentication code', 'auth.mfa_invalid_code');
      }
    }
    const secret = generateSecret();
    if (existing?.confirmed) {
      const staged = await this.repo.stageTotpReplacement(
        userId, this.encryptSecret(secret), existing.secretEncrypted,
      );
      if (!staged) {
        conflict('MFA factor changed during replacement setup', 'auth.mfa_state_changed');
      }
    } else {
      const staged = await this.repo.upsertPendingTotp(userId, this.encryptSecret(secret));
      if (!staged) {
        conflict('MFA status changed during setup', 'auth.mfa_state_changed');
      }
    }
    const otpauthUrl = generateURI({ issuer: TOTP_ISSUER, label: username, secret });
    return { secret, otpauthUrl };
  }

  async confirm(userId: string, code: string): Promise<void> {
    const row = await this.repo.getTotpByUserId(userId);
    if (!row) badRequest('TOTP has not been set up for this account', 'auth.mfa_not_setup');
    if (row.confirmed) {
      const pending = await this.repo.getPendingTotpReplacement(userId);
      if (!pending) badRequest('TOTP replacement has expired or was not started', 'auth.mfa_not_setup');
      if (!(await this.verifyCode(this.decryptSecret(pending.secretEncrypted), code))) {
        unauthorized('Invalid two-factor authentication code', 'auth.mfa_invalid_code');
      }
      if (!(await this.repo.activateTotpReplacement(userId, pending))) {
        conflict('MFA factor changed during replacement confirmation', 'auth.mfa_state_changed');
      }
      return;
    }
    if (!(await this.verifyCode(this.decryptSecret(row.secretEncrypted), code))) {
      unauthorized('Invalid two-factor authentication code', 'auth.mfa_invalid_code');
    }
    if (!(await this.repo.confirmTotp(userId, row.secretEncrypted))) {
      conflict('MFA factor changed during confirmation', 'auth.mfa_state_changed');
    }
  }

  async disable(userId: string, code: string): Promise<void> {
    const row = await this.repo.getTotpByUserId(userId);
    if (!row?.confirmed) badRequest('Two-factor authentication is not enabled for this account', 'auth.mfa_not_enabled');
    if (!(await this.verifyCode(this.decryptSecret(row.secretEncrypted), code))) {
      unauthorized('Invalid two-factor authentication code', 'auth.mfa_invalid_code');
    }
    if (!(await this.repo.disableTotpIfMatches(userId, row.secretEncrypted))) {
      conflict('MFA factor changed during disable', 'auth.mfa_state_changed');
    }
  }

  async verifyForUser(userId: string, code: string): Promise<boolean> {
    const row = await this.repo.getTotpByUserId(userId);
    if (!row?.confirmed) return false;
    return this.verifyCode(this.decryptSecret(row.secretEncrypted), code);
  }

  async resetForUser(userId: string): Promise<void> {
    await this.repo.deleteTotp(userId);
  }
}
