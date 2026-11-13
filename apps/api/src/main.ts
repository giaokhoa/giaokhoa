import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { enableTrustedProxy } from './common/client-ip';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { mountBetterAuth } from './modules/auth/better-auth/better-auth.mount';
import { BetterAuthService } from './modules/auth/better-auth/better-auth.service';
import { McpDepsService } from './modules/mcp/mcp-deps.service';
import { mountMcp } from './modules/mcp/mcp.mount';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  enableTrustedProxy(app);

  const betterAuth = app.get(BetterAuthService);
  if (betterAuth.auth) {
    mountBetterAuth(app, betterAuth.requireAuth(), app.get(SpaceDatabaseService, { strict: false }));
  }
  mountMcp(app, app.get(McpDepsService).createMountDeps());
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.enableShutdownHooks();

  app.use(compression());

  const webDistDir = config.get<string>('WEB_DIST_DIR');
  if (webDistDir && existsSync(join(webDistDir, 'index.html'))) {
    app.useStaticAssets(webDistDir, {
      setHeaders: (res: Response, filePath: string) => {
        if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDistDir, 'index.html'), (err) => (err ? next(err) : undefined));
    });
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Giáo khoa API')
      .setDescription('TypeScript Giáo khoa — Moodle core business equivalent (backend)')
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(config.get<number>('PORT') ?? 3000);
}

void bootstrap();
