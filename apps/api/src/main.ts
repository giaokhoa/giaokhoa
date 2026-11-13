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
  // Tin đúng một chặng proxy (tiến trình web ở biên) để req.ip là IP khách thật — xem common/client-ip.ts.
  enableTrustedProxy(app);
  const config = app.get(ConfigService);
  // Express middleware CORS phải nằm trước các mount trực tiếp Better Auth/MCP,
  // vì route mount ngoài pipeline của Nest vẫn cần xử lý preflight OPTIONS.
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Better Auth (issue #7): chỉ khi instance tồn tại — cờ BETTER_AUTH_ENABLED (GĐ1) HOẶC cờ MCP_AS_ENABLED (AS cho MCP của issue #163) bật; cả hai mặc định tắt, hành vi live không đổi — mới mount handler của nó tại /api/v1/auth/*, lên express instance TRƯỚC khi Nest đăng ký route và body parser của nó (xem better-auth.mount.ts). Cả hai cờ tắt thì nhánh này không chạy và đường auth hiện tại xử lý mọi request như trước.
  const betterAuth = app.get(BetterAuthService);
  if (betterAuth.auth) {
    // Truyền khung định tuyến để đường GHI của Better Auth (đăng nhập) cũng đi đúng kho đích tại địa chỉ trung tâm ở kho riêng — xem chú thích B1 ở better-auth.mount.ts.
    mountBetterAuth(app, betterAuth.requireAuth(), app.get(SpaceDatabaseService, { strict: false }));
  }
  // MCP server (issue #110, lát MCP-0): mount POST /mcp + PRM lên express instance ngay tại đây — trước prefix/route/body parser của Nest và trước SPA fallback phía dưới — như tiền lệ Better Auth. Deps do McpModule inject đúng hệ module (issue #138): bootstrap chỉ lấy facade McpDepsService đã export từ container.
  mountMcp(app, app.get(McpDepsService).createMountDeps());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Validation toàn cục đi qua APP_PIPE (I18nStandardSchemaValidationPipe) đã đăng ký trong AppModule — mọi payload đều là schema Zod.
  app.useGlobalFilters(new ProblemDetailsFilter());
  // Polling và WebSocket dùng lại allowlist CORS đã đặt trước các mount.
  // Adapter kết nối Redis trước app.listen() để không rơi về in-memory.
  const socketAdapter = new MessagingRedisIoAdapter(app, config.getOrThrow<string>('REDIS_URL'), corsOrigins);
  await socketAdapter.connectToRedis();
  app.useWebSocketAdapter(socketAdapter);
  app.enableShutdownHooks();

  // Production giao toàn bộ việc nén phản hồi cho Caddy (encode zstd/gzip).

  // Triển khai gộp một tiến trình: khi WEB_DIST_DIR trỏ tới bản build của web app, API phục vụ luôn các file tĩnh đó, và mọi GET không thuộc /api được trả index.html để React Router tự điều hướng phía client (SPA fallback). Không đặt biến này thì API giữ hành vi cũ, chỉ phục vụ /api.
  const webDistDir = config.get<string>('WEB_DIST_DIR');
  if (webDistDir && existsSync(join(webDistDir, 'index.html'))) {
    app.useStaticAssets(webDistDir, {
      setHeaders: (res: Response, filePath: string) => {
        // Tên file trong assets/ đã chứa hash nội dung: cache vĩnh viễn
        // (immutable) để F5 không phải hỏi lại server từng asset. Vỏ
        // index.html thì ngược lại — luôn kiểm tra lại (no-cache) để bản build mới có hiệu lực ngay.
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
