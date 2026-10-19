import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { envSchema } from '../config/env.js';
import * as schema from '@giaokhoa/database/schema';
import { createAuth } from './auth.js';

const env = envSchema.parse(process.env);
const db = drizzle({
  connection: env.DATABASE_URL,
  schema,
});

export const auth = createAuth(
  db,
  {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    BETTER_AUTH_TRUSTED_ORIGINS: env.BETTER_AUTH_TRUSTED_ORIGINS,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
  },
  'uuid',
);
