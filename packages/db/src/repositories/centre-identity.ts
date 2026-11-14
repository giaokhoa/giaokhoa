import type { Insertable, Updateable } from 'kysely';
import type { CentreDb, CentreDB } from '../client';
import { applyDefined } from './mapping';

export interface CentreIdentityRow {
  id: string;
  tenantId: string;
  displayName: string;
  logoPath: string | null;
  brandColor: string | null;
  updatedAt: Date;
}

export interface CentreInviteRow {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const CENTRE_IDENTITY_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'display_name as displayName',
  'logo_path as logoPath',
  'brand_color as brandColor',
  'updated_at as updatedAt',
] as const;

const CENTRE_INVITE_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'user_id as userId',
  'email',
  'token_hash as tokenHash',
  'expires_at as expiresAt',
  'used_at as usedAt',
  'revoked_at as revokedAt',
  'created_at as createdAt',
] as const;

export class CentreIdentityRepository {
  constructor(private readonly handle: CentreDb) {}

  async getIdentity(tenantId: string): Promise<CentreIdentityRow | undefined> {
    return this.handle
      .selectFrom('centre_identity')
      .select(CENTRE_IDENTITY_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .limit(1)
      .executeTakeFirst();
  }

  async upsertIdentity(
    tenantId: string,
    patch: { displayName?: string; logoPath?: string | null; brandColor?: string | null },
  ): Promise<CentreIdentityRow> {
    const existing = await this.getIdentity(tenantId);
    if (!existing) {
      const values: Insertable<CentreDB['centre_identity']> = {
        tenant_id: tenantId,
        display_name: patch.displayName ?? '',
        logo_path: patch.logoPath ?? null,
        brand_color: patch.brandColor ?? null,
      };
      const rows = await this.handle
        .insertInto('centre_identity')
        .values(values)
        .returning(CENTRE_IDENTITY_COLUMNS)
        .execute();
      return rows[0]!;
    }
    const set: Updateable<CentreDB['centre_identity']> = { updated_at: new Date() };
    applyDefined(set, patch, [
      ['displayName', 'display_name'],
      ['logoPath', 'logo_path'],
      ['brandColor', 'brand_color'],
    ]);
    const rows = await this.handle
      .updateTable('centre_identity')
      .set(set)
      .where('id', '=', existing.id)
      .returning(CENTRE_IDENTITY_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async findInviteByTokenHash(tokenHash: string): Promise<CentreInviteRow | undefined> {
    return this.handle
      .selectFrom('centre_invites')
      .select(CENTRE_INVITE_COLUMNS)
      .where('token_hash', '=', tokenHash)
      .limit(1)
      .executeTakeFirst();
  }

  async markInviteUsed(id: string): Promise<CentreInviteRow | undefined> {
    const rows = await this.handle
      .updateTable('centre_invites')
      .set({ used_at: new Date() })
      .where('id', '=', id)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .returning(CENTRE_INVITE_COLUMNS)
      .execute();
    return rows[0];
  }

  async revokePendingInvites(userId: string): Promise<void> {
    await this.handle
      .updateTable('centre_invites')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async listSiteAdmins(): Promise<string[]> {
    const row = await this.handle
      .selectFrom('config')
      .select(['value'])
      .where('key', '=', 'siteadmins')
      .limit(1)
      .executeTakeFirst();
    const value = row?.value;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }
}
