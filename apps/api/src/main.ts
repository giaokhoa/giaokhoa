import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new BadRequestException(
          issues.map(({ path, message }) => ({
            path:
              path?.map((segment) => (typeof segment === 'object' ? segment.key : segment)) ?? [],
            message,
          })),
        ),
    }),
  );
  app.enableCors({
    origin: config.get('BETTER_AUTH_TRUSTED_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

await bootstrap();
