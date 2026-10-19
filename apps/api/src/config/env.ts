import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().pipe(z.int().min(1).max(65535)).default(3000),
    DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//, 'must be a PostgreSQL connection URL'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    IMAGE_ORPHAN_TTL_HOURS: z.coerce.number().positive().default(24),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_TRUSTED_ORIGINS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    GOOGLE_CLIENT_ID: optionalSecret,
    GOOGLE_CLIENT_SECRET: optionalSecret,
    RESEND_API_KEY: optionalSecret,
    RESEND_FROM_EMAIL: optionalSecret,
  })
  .superRefine((env, ctx) => {
    for (const [left, right] of [
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
    ] as const) {
      if (Boolean(env[left]) !== Boolean(env[right])) {
        ctx.addIssue({
          code: 'custom',
          path: [left],
          message: `${left} và ${right} phải được cấu hình cùng nhau`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
