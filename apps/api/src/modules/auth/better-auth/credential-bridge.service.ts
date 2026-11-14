import { Injectable } from '@nestjs/common';
import type { BetterAuthOptions } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';
import { createInternalAdapter } from 'better-auth/db';
import type { CentreDb } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import { BetterAuthService } from './better-auth.service';

export interface CreateUserWithCredentialInput {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  emailVerified?: boolean;
}

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

@Injectable()
export class CredentialBridgeService {
  private readonly db: CentreDb;

  constructor(
    private readonly betterAuth: BetterAuthService,
    spaceDb: SpaceDatabaseService,
  ) {
    this.db = spaceDb.routedKysely;
  }

  private async assertUsernameAllowed(username: string): Promise<void> {
    if (username.length < USERNAME_MIN_LENGTH) {
      throw new Error(
        `username quá ngắn: tối thiểu ${USERNAME_MIN_LENGTH} ký tự theo luật plugin username của Better Auth`,
      );
    }
    if (username.length > USERNAME_MAX_LENGTH) {
      throw new Error(
        `username quá dài: tối đa ${USERNAME_MAX_LENGTH} ký tự theo luật plugin username của Better Auth`,
      );
    }
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error(
        'username không hợp lệ: chỉ chấp nhận chữ cái, chữ số, dấu "_" và "." theo luật plugin username của Better Auth',
      );
    }
    const existing = await this.db
      .selectFrom('users')
      .select('id')
      .where('username', '=', username.toLowerCase())
      .limit(1)
      .executeTakeFirst();
    if (existing) {
      throw new Error(`username đã được sử dụng: "${username.toLowerCase()}" đã tồn tại`);
    }
  }

  async createUserWithCredential(input: CreateUserWithCredentialInput): Promise<{ id: string }> {
    await this.assertUsernameAllowed(input.username);
    const auth = this.betterAuth.requireAuth();
    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash(input.password);
    const adapterTransaction = ctx.adapter.transaction;
    if (!adapterTransaction) {
      throw new Error(
        'Better Auth adapter không có transaction thật (factory phải giữ transaction: true) — createUserWithCredential từ chối chạy không nguyên tử',
      );
    }
    const user = await adapterTransaction(async (trx) => {
      const txInternalAdapter = createInternalAdapter(
        trx as unknown as Parameters<typeof createInternalAdapter>[0],
        {
          options: ctx.options as BetterAuthOptions,
          logger: ctx.logger,
          hooks: (ctx.options as BetterAuthOptions).databaseHooks
            ? [
                {
                  source: 'user',
                  hooks: (ctx.options as BetterAuthOptions).databaseHooks!,
                },
              ]
            : [],
          generateId: ctx.generateId,
        },
      );
      const created = await txInternalAdapter.createUser(
        {
          email: input.email,
          name: input.firstName,
          username: input.username,
          emailVerified: input.emailVerified ?? true,
        },
        { method: 'admin' },
      );
      await txInternalAdapter.createAccount({
        userId: created.id,
        providerId: 'credential',
        accountId: created.id,
        password: passwordHash,
      });
      return created;
    });
    if (input.lastName) {
      try {
        await this.db.updateTable('users').set({ last_name: input.lastName }).where('id', '=', user.id).execute();
      } catch (error) {
        try {
          const removed = await this.db.deleteFrom('users')
            .where('id', '=', user.id).returning('id').executeTakeFirst();
          if (!removed) throw new Error('New user vanished while reverting name update', { cause: error });
        } catch (cleanupError) {
          throw new Error('Credential bridge cleanup failed after last_name update', { cause: cleanupError });
        }
        throw error;
      }
    }
    return { id: user.id };
  }

  async linkExistingPasswordHash(userId: string): Promise<boolean> {
    this.betterAuth.requireAuth();
    const row = await this.db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    if (!row?.password_hash) return false;
    const existing = await this.db
      .selectFrom('account')
      .select('id')
      .where('user_id', '=', userId)
      .where('provider_id', '=', 'credential')
      .limit(1)
      .executeTakeFirst();
    if (existing) return false;
    const inserted = await this.db
      .insertInto('account')
      .values({
        user_id: userId,
        provider_id: 'credential',
        account_id: userId,
        password: row.password_hash,
      })
      .onConflict((oc) => oc.columns(['user_id', 'provider_id']).doNothing())
      .returning('id')
      .execute();
    if (inserted.length === 0) return false;
    await this.db.updateTable('users').set({ email_verified: true }).where('id', '=', userId).execute();
    return true;
  }

  async syncCredentialPassword(userId: string): Promise<boolean> {
    if (!this.betterAuth.auth) return false;
    const row = await this.db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    if (!row?.password_hash) return false;
    const existing = await this.db
      .selectFrom('account')
      .select(['id', 'password'])
      .where('user_id', '=', userId)
      .where('provider_id', '=', 'credential')
      .limit(1)
      .executeTakeFirst();
    if (existing) {
      if (existing.password === row.password_hash) return false;
      await this.db
        .updateTable('account')
        .set({ password: row.password_hash, updated_at: new Date() })
        .where('id', '=', existing.id)
        .execute();
      return true;
    }
    const inserted = await this.db
      .insertInto('account')
      .values({
        user_id: userId,
        provider_id: 'credential',
        account_id: userId,
        password: row.password_hash,
      })
      .onConflict((oc) => oc.columns(['user_id', 'provider_id']).doNothing())
      .returning('id')
      .execute();
    return inserted.length > 0;
  }

  async revokeSessionsForUser(userId: string): Promise<number> {
    if (!this.betterAuth.auth) return 0;
    const deleted = await this.db
      .deleteFrom('session')
      .where('user_id', '=', userId)
      .returning('id')
      .execute();
    return deleted.length;
  }

  async createProgrammaticSession(userId: string): Promise<{
    sessionId: string;
    token: string;
    signedCookieValue: string;
    expiresAt: Date;
  }> {
    const auth = this.betterAuth.requireAuth();
    const ctx = await auth.$context;
    const session = await ctx.internalAdapter.createSession(userId, false);
    const signature = await makeSignature(session.token, ctx.secret);
    return {
      sessionId: session.id,
      token: session.token,
      signedCookieValue: `${session.token}.${signature}`,
      expiresAt: session.expiresAt,
    };
  }
}
