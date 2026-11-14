import { DocumentBuilder } from '@nestjs/swagger';

export function buildOpenApiDocumentConfig() {
  return new DocumentBuilder()
    .setTitle('Giáo khoa API')
    .setDescription('TypeScript Giáo khoa — Moodle core business equivalent (backend)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}
