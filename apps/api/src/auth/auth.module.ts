import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import type { Env } from '../config/env.js';
import type { Database } from '@giaokhoa/database/types';
import { AuthController } from './auth.controller.js';
import { createAuth } from './auth.js';

@Module({
  imports: [
    BetterAuthModule.forRootAsync({
      inject: [getDrizzleToken(), ConfigService],
      useFactory: (db: Database, config: ConfigService<Env, true>) => ({
        auth: createAuth(db, {
          BETTER_AUTH_SECRET: config.get('BETTER_AUTH_SECRET', { infer: true }),
          BETTER_AUTH_URL: config.get('BETTER_AUTH_URL', { infer: true }),
          BETTER_AUTH_TRUSTED_ORIGINS: config.get('BETTER_AUTH_TRUSTED_ORIGINS', {
            infer: true,
          }),
          GOOGLE_CLIENT_ID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
          GOOGLE_CLIENT_SECRET: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
          RESEND_API_KEY: config.get('RESEND_API_KEY', { infer: true }),
          RESEND_FROM_EMAIL: config.get('RESEND_FROM_EMAIL', { infer: true }),
        }),
      }),
    }),
  ],
  controllers: [AuthController],
})
export class AuthModule {}
