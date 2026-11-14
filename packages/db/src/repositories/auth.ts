import { sql, type Insertable } from 'kysely';
import type { CentreDb, CentreDB, CentreTx } from '../client';
import { applyDefined } from './mapping';

export type AuthDb = CentreDb | CentreTx;

export interface RefreshFamilyRow {
  id: string;
  familyId: string;
  userId: string;
  tenantId: string | null;
  ip: string | null;
  userAgent: string | null;
  currentTokenHash: string;
  previousTokenHash: string | null;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  rotatedAt: Date;
}

export interface PendingTotpReplacement {
  secretEncrypted: string;
  activeSecretEncrypted: string;
}

export interface UserTotpRow {
  id: string;
  userId: string;
  secretEncrypted: string;
  confirmed: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface UserOauthLinkRow {
  id: string;
  userId: string;
  issuer: string;
  issuerUserId: string;
  email: string;
  createdAt: Date;
}

export interface LoginAttemptRow {
  id: string;
  userId: string | null;
  username: string;
  success: boolean;
  ip: string | null;
  attemptedAt: Date;
}

export interface NewRefreshFamily {
  id?: string;
  familyId: string;
  userId: string;
  tenantId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  currentTokenHash: string;
  previousTokenHash?: string | null;
  revoked?: boolean;
  expiresAt: Date;
  createdAt?: Date;
  rotatedAt?: Date;
}

export interface NewOauthLink {
  id?: string;
  userId: string;
  issuer: string;
  issuerUserId: string;
  email: string;
  createdAt?: Date;
}

export interface NewLoginAttempt {
  id?: string;
  userId?: string | null;
  username: string;
  success: boolean;
  ip?: string | null;
  attemptedAt?: Date;
}

const REFRESH_FAMILY_COLUMNS = [
  'id',
  'family_id as familyId',
  'user_id as userId',
  'tenant_id as tenantId',
  'ip',
  'user_agent as userAgent',
  'current_token_hash as currentTokenHash',
  'previous_token_hash as previousTokenHash',
  'revoked',
  'expires_at as expiresAt',
  'created_at as createdAt',
  'rotated_at as rotatedAt',
] as const;

const USER_TOTP_COLUMNS = [
  'id',
  'user_id as userId',
  'secret_encrypted as secretEncrypted',
  'confirmed',
  'created_at as createdAt',
  'confirmed_at as confirmedAt',
] as const;

const USER_OAUTH_LINK_COLUMNS = [
  'id',
  'user_id as userId',
  'issuer',
  'issuer_user_id as issuerUserId',
  'email',
  'created_at as createdAt',
] as const;

const LOGIN_ATTEMPT_COLUMNS = [
  'id',
  'user_id as userId',
  'username',
  'success',
  'ip',
  'attempted_at as attemptedAt',
] as const;

function refreshFamilyInsertValues(values: NewRefreshFamily): Insertable<CentreDB['refresh_token_family']> {
  const row: Insertable<CentreDB['refresh_token_family']> = {
    family_id: values.familyId,
    user_id: values.userId,
    current_token_hash: values.currentTokenHash,
    expires_at: values.expiresAt,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['tenantId', 'tenant_id'],
    ['ip', 'ip'],
    ['userAgent', 'user_agent'],
    ['previousTokenHash', 'previous_token_hash'],
    ['revoked', 'revoked'],
    ['createdAt', 'created_at'],
    ['rotatedAt', 'rotated_at'],
  ]);
  return row;
}

function oauthLinkInsertValues(values: NewOauthLink): Insertable<CentreDB['user_oauth_links']> {
  const row: Insertable<CentreDB['user_oauth_links']> = {
    user_id: values.userId,
    issuer: values.issuer,
    issuer_user_id: values.issuerUserId,
    email: values.email,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function loginAttemptInsertValues(values: NewLoginAttempt): Insertable<CentreDB['login_attempts']> {
  const row: Insertable<CentreDB['login_attempts']> = {
    username: values.username,
    success: values.success,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['userId', 'user_id'],
    ['ip', 'ip'],
    ['attemptedAt', 'attempted_at'],
  ]);
  return row;
}

export class AuthRepository {
  constructor(private readonly handle: AuthDb) {}

  async createFamily(v: NewRefreshFamily): Promise<RefreshFamilyRow> {
    const rows = await this.handle
      .insertInto('refresh_token_family')
      .values(refreshFamilyInsertValues(v))
      .returning(REFRESH_FAMILY_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getFamilyByHash(tokenHash: string): Promise<RefreshFamilyRow | undefined> {
    return this.handle
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where((eb) => eb.or([
        eb('current_token_hash', '=', tokenHash),
        eb('previous_token_hash', '=', tokenHash),
      ]))
      .executeTakeFirst();
  }

  async getFamilyById(familyId: string): Promise<RefreshFamilyRow | undefined> {
    return this.handle
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where('family_id', '=', familyId)
      .executeTakeFirst();
  }

  async setFamilyTenant(id: string, tenantId: string): Promise<void> {
    await this.handle
      .updateTable('refresh_token_family')
      .set({ tenant_id: tenantId })
      .where('id', '=', id)
      .execute();
  }

  async rotateFamily(id: string, currentTokenHash: string, previousTokenHash: string): Promise<void> {
    await this.handle
      .updateTable('refresh_token_family')
      .set({ current_token_hash: currentTokenHash, previous_token_hash: previousTokenHash, rotated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async revokeFamily(id: string): Promise<void> {
    await this.handle
      .updateTable('refresh_token_family')
      .set({ revoked: true })
      .where('id', '=', id)
      .execute();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.handle
      .updateTable('refresh_token_family')
      .set({ revoked: true })
      .where('user_id', '=', userId)
      .execute();
  }

  async listActiveFamiliesByUser(userId: string): Promise<RefreshFamilyRow[]> {
    return this.handle
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where('user_id', '=', userId)
      .where('revoked', '=', false)
      .where('expires_at', '>=', new Date())
      .orderBy('created_at', 'desc')
      .execute();
  }

  async getFamilyByFamilyId(familyId: string): Promise<RefreshFamilyRow | undefined> {
    return this.handle
      .selectFrom('refresh_token_family')
      .select(REFRESH_FAMILY_COLUMNS)
      .where('family_id', '=', familyId)
      .executeTakeFirst();
  }

  async revokeOthersForUser(userId: string, keepFamilyId?: string): Promise<number> {
    const active = await this.listActiveFamiliesByUser(userId);
    const targets = active.filter((f) => f.familyId !== keepFamilyId);
    for (const family of targets) await this.revokeFamily(family.id);
    return targets.length;
  }


  async createOauthLink(v: NewOauthLink): Promise<UserOauthLinkRow> {
    const rows = await this.handle
      .insertInto('user_oauth_links')
      .values(oauthLinkInsertValues(v))
      .returning(USER_OAUTH_LINK_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getOauthLinkBySubject(issuer: string, issuerUserId: string): Promise<UserOauthLinkRow | undefined> {
    return this.handle
      .selectFrom('user_oauth_links')
      .select(USER_OAUTH_LINK_COLUMNS)
      .where('issuer', '=', issuer)
      .where('issuer_user_id', '=', issuerUserId)
      .executeTakeFirst();
  }

  async listOauthLinksByUser(userId: string): Promise<UserOauthLinkRow[]> {
    return this.handle
      .selectFrom('user_oauth_links')
      .select(USER_OAUTH_LINK_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async getOauthLinkById(id: string): Promise<UserOauthLinkRow | undefined> {
    return this.handle
      .selectFrom('user_oauth_links')
      .select(USER_OAUTH_LINK_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async deleteOauthLink(id: string): Promise<void> {
    await this.handle.deleteFrom('user_oauth_links').where('id', '=', id).execute();
  }


  async getTotpByUserId(userId: string): Promise<UserTotpRow | undefined> {
    return this.handle
      .selectFrom('user_totp')
      .select(USER_TOTP_COLUMNS)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  async upsertPendingTotp(userId: string, secretEncrypted: string): Promise<UserTotpRow | undefined> {
    const rows = await this.handle
      .insertInto('user_totp')
      .values({ user_id: userId, secret_encrypted: secretEncrypted, confirmed: false, confirmed_at: null })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({
        secret_encrypted: secretEncrypted,
        confirmed: false,
        confirmed_at: null,
        created_at: new Date(),
      }).where('user_totp.confirmed', '=', false))
      .returning(USER_TOTP_COLUMNS)
      .execute();
    return rows[0];
  }

  async stageTotpReplacement(
    userId: string,
    secretEncrypted: string,
    activeSecretEncrypted: string,
  ): Promise<boolean> {
    const identifier = 'totp-replace-' + userId;
    const expiresAt = new Date(Date.now() + 600_000);
    return this.handle.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const active = await trx.selectFrom('user_totp')
        .select(['secret_encrypted', 'confirmed'])
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!active?.confirmed || active.secret_encrypted !== activeSecretEncrypted) return false;

      const payload: PendingTotpReplacement = { secretEncrypted, activeSecretEncrypted };
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
      await trx.insertInto('verification')
        .values({ identifier, value: JSON.stringify(payload), expires_at: expiresAt }).execute();
      return true;
    });
  }

  async getPendingTotpReplacement(userId: string): Promise<PendingTotpReplacement | undefined> {
    const row = await this.handle.selectFrom('verification')
      .select(['value', 'expires_at'])
      .where('identifier', '=', 'totp-replace-' + userId)
      .executeTakeFirst();
    if (!row || row.expires_at <= new Date()) return undefined;
    try {
      const payload: unknown = JSON.parse(row.value);
      if (!payload || typeof payload !== 'object') return undefined;
      const candidate = payload as Partial<PendingTotpReplacement>;
      if (typeof candidate.secretEncrypted !== 'string' ||
          typeof candidate.activeSecretEncrypted !== 'string' ||
          !candidate.secretEncrypted || !candidate.activeSecretEncrypted) return undefined;
      return {
        secretEncrypted: candidate.secretEncrypted,
        activeSecretEncrypted: candidate.activeSecretEncrypted,
      };
    } catch {
      return undefined;
    }
  }

  async activateTotpReplacement(userId: string, candidate: PendingTotpReplacement): Promise<boolean> {
    return this.handle.transaction().execute(async (trx) => {
      const identifier = 'totp-replace-' + userId;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const pending = await trx.selectFrom('verification')
        .select(['value', 'expires_at'])
        .where('identifier', '=', identifier)
        .forUpdate()
        .executeTakeFirst();
      if (!pending || pending.value !== JSON.stringify(candidate) || pending.expires_at <= new Date()) {
        return false;
      }
      const active = await trx.updateTable('user_totp')
        .set({ secret_encrypted: candidate.secretEncrypted, confirmed: true, confirmed_at: new Date() })
        .where('user_id', '=', userId)
        .where('confirmed', '=', true)
        .where('secret_encrypted', '=', candidate.activeSecretEncrypted)
        .returning('user_id')
        .executeTakeFirst();
      if (!active) return false;
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
      return true;
    });
  }

  async clearPendingTotpReplacement(userId: string): Promise<void> {
    await this.handle.deleteFrom('verification')
      .where('identifier', '=', 'totp-replace-' + userId)
      .execute();
  }

  async confirmTotp(userId: string, encryptedSecret: string): Promise<boolean> {
    const row = await this.handle
      .updateTable('user_totp')
      .set({ confirmed: true, confirmed_at: new Date() })
      .where('user_id', '=', userId)
      .where('secret_encrypted', '=', encryptedSecret)
      .where('confirmed', '=', false)
      .returning('user_id')
      .executeTakeFirst();
    return Boolean(row);
  }

  async disableTotpIfMatches(userId: string, activeSecretEncrypted: string): Promise<boolean> {
    const identifier = 'totp-replace-' + userId;
    return this.handle.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const removed = await trx.deleteFrom('user_totp')
        .where('user_id', '=', userId)
        .where('confirmed', '=', true)
        .where('secret_encrypted', '=', activeSecretEncrypted)
        .returning('user_id')
        .executeTakeFirst();
      if (!removed) return false;
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
      return true;
    });
  }

  async deleteTotp(userId: string): Promise<void> {
    const identifier = 'totp-replace-' + userId;
    await this.handle.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      await trx.deleteFrom('user_totp').where('user_id', '=', userId).execute();
      await trx.deleteFrom('verification').where('identifier', '=', identifier).execute();
    });
  }

  async recordAttempt(v: NewLoginAttempt): Promise<void> {
    await this.handle.insertInto('login_attempts').values(loginAttemptInsertValues(v)).execute();
  }

  async recentFailedAttempts(userId: string, since: Date): Promise<LoginAttemptRow[]> {
    return this.handle
      .selectFrom('login_attempts')
      .select(LOGIN_ATTEMPT_COLUMNS)
      .where('user_id', '=', userId)
      .where('success', '=', false)
      .where('attempted_at', '>=', since)
      .orderBy('attempted_at', 'desc')
      .execute();
  }

  async lastSuccessfulAttemptAt(userId: string): Promise<Date | undefined> {
    const row = await this.handle
      .selectFrom('login_attempts')
      .select(LOGIN_ATTEMPT_COLUMNS)
      .where('user_id', '=', userId)
      .where('success', '=', true)
      .orderBy('attempted_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.attemptedAt;
  }
}
