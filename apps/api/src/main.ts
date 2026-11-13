import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { enableTrustedProxy } from './common/client-ip';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { mountBetterAuth } from './modules/auth/better-auth/better-auth.mount';
import { BetterAuthService } from './modules/auth/better-auth/better-auth.service';
import { McpDepsService } from './modules/mcp/mcp-deps.service';
import { mountMcp } from './modules/mcp/mcp.mount';
import { MessagingRedisIoAdapter } from './modules/messaging/messaging-redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  enableTrustedProxy(app);
  const config = app.get(ConfigService);


  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  const betterAuth = app.get(BetterAuthService);
  if (betterAuth.auth) {
    mountBetterAuth(app, betterAuth.requireAuth(), app.get(SpaceDatabaseService, { strict: false }));
  }
  mountMcp(app, app.get(McpDepsService).createMountDeps());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());


  const socketAdapter = new MessagingRedisIoAdapter(app, config.getOrThrow<string>('REDIS_URL'), corsOrigins);
  await socketAdapter.connectToRedis();
  app.useWebSocketAdapter(socketAdapter);
  app.enableShutdownHooks();



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
      // Kiểm tra đúng biên path: /apixyz là SPA route hợp lệ, còn MCP,
      // Socket.IO và OAuth metadata không được nhận nhầm HTML.
      const apiPaths = ['/api', '/mcp', '/socket.io', '/.well-known'];
      if (req.method !== 'GET' || apiPaths.some((path) => req.path === path || req.path.startsWith(`${path}/`))) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDistDir, 'index.html'), (err) => (err ? next(err) : undefined));
    });
  }

  const documentConfig = new DocumentBuilder()
    .setTitle('Giáo khoa API')
    .setDescription('TypeScript Giáo khoa — Moodle core business equivalent (backend)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // Chỉ dựng OpenAPI khi truy cập tài liệu, giảm thời gian bootstrap.
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, documentConfig));

  await app.listen(config.get<number>('PORT') ?? 3000);
}

void bootstrap();
