import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  const trustedOrigins = config.get('BETTER_AUTH_TRUSTED_ORIGINS', { infer: true });
  app.enableCsrfProtection({ trustedOrigins });
  app.enableCors({ origin: trustedOrigins, credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

await bootstrap();
