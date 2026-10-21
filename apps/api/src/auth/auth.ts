import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { Resend } from 'resend';
import type { Env } from '../config/env.js';
import type { Database } from '@giaokhoa/database/types';

type AuthEnv = Pick<
  Env,
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'BETTER_AUTH_TRUSTED_ORIGINS'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'RESEND_API_KEY'
  | 'RESEND_FROM_EMAIL'
>;

export function createAuth(db: Database, env: AuthEnv, generateId: false | 'uuid' = false) {
  const resend =
    env.RESEND_API_KEY && env.RESEND_FROM_EMAIL ? new Resend(env.RESEND_API_KEY) : undefined;

  return betterAuth({
    appName: 'Giáo khoa',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
    }),
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              requireEmailVerification: true,
            },
          }
        : undefined,
    emailVerification: {
      autoSignInAfterVerification: true,
      sendOnSignIn: true,
      sendOnSignUp: true,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: Boolean(resend),
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      }),
    },
    // Better Auth sở hữu xác thực và trạng thái khóa đăng nhập, không sở hữu vai trò hay quyền.
    user: {
      additionalFields: {
        banned: { type: 'boolean', defaultValue: false, input: false },
        banReason: { type: 'string', required: false, input: false },
        banExpires: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, ctx) {
            if (!ctx) return;
            const found = await ctx.context.internalAdapter.findUserById(session.userId);
            const user = found as
              | (typeof found & { banned?: boolean; banExpires?: Date | null })
              | null;
            if (!user?.banned) return;
            if (user.banExpires && new Date(user.banExpires).getTime() <= Date.now()) {
              await ctx.context.internalAdapter.updateUser(session.userId, {
                banned: false,
                banReason: null,
                banExpires: null,
              });
              return;
            }
            throw new APIError('FORBIDDEN', {
              code: 'ACCOUNT_SUSPENDED',
              message: 'Tài khoản đã bị khóa',
            });
          },
        },
      },
    },
    plugins: [
      emailOTP({
        overrideDefaultEmailVerification: true,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          if (!resend || !env.RESEND_FROM_EMAIL) {
            throw new Error('Email OTP chưa được cấu hình');
          }

          const subject =
            type === 'email-verification'
              ? 'Mã xác minh email Giáo khoa'
              : type === 'forget-password'
                ? 'Mã đặt lại mật khẩu Giáo khoa'
                : 'Mã đăng nhập Giáo khoa';

          const { error } = await resend.emails.send({
            from: env.RESEND_FROM_EMAIL,
            to: email,
            subject,
            text: [
              `Mã OTP của bạn là: ${otp}`,
              '',
              'Mã có hiệu lực trong 5 phút.',
              'Nếu bạn không yêu cầu mã này, bạn có thể bỏ qua email.',
            ].join('\n'),
          });

          if (error) throw new Error(error.message);
        },
      }),
    ],
    advanced: {
      database: {
        generateId,
        joins: true,
      },
    },
  });
}
