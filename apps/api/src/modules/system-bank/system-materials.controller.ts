import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { rejectSystemBankSubmissionSchema, submitSystemMaterialSchema, useSystemMaterialSchema, uuidIdSchema, type UseSystemMaterial } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemMaterialsService } from './system-materials.service';

export function sendMaterialFile(res: Response, result: Awaited<ReturnType<SystemMaterialsService['readFile']>>) {
  res.attachment(result.file.fileName);
  res.setHeader('Content-Type', result.file.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.send(result.data);
}

@Controller({ path: 'system-bank/materials', version: '1' })
export class SystemMaterialsController {
  constructor(private readonly materials: SystemMaterialsService) {}

  @Get('submissions/sources')
  sources(@CurrentUser() actor: AuthenticatedUser) { return this.materials.sources(actor.id); }

  @Post('submissions')
  submit(@CurrentUser() actor: AuthenticatedUser, @Body({ schema: submitSystemMaterialSchema }) dto: { contentId: string }) {
    return this.materials.submit(actor.id, dto.contentId);
  }

  @Get('submissions/mine')
  mine(@CurrentUser() actor: AuthenticatedUser) { return this.materials.mine(actor.id); }

  @Get('submissions/pending')
  pending(@CurrentUser() actor: AuthenticatedUser) { return this.materials.pending(actor.id); }

  @Get('submissions/:id')
  submission(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.materials.forReview(actor.id, id);
  }

  @Get('submissions/:id/media')
  async reviewMedia(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string, @Res() res: Response) {
    sendMaterialFile(res, await this.materials.preview(actor.id, id));
  }

  @Post('submissions/:id/approve')
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.materials.review(actor.id, id);
  }

  @Post('submissions/:id/reject')
  reject(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: rejectSystemBankSubmissionSchema }) dto: { reason: string }) {
    return this.materials.review(actor.id, id, dto.reason);
  }

  @Get()
  discover(@CurrentUser() actor: AuthenticatedUser) { return this.materials.discover(actor.id); }

  @Post('use')
  use(@CurrentUser() actor: AuthenticatedUser, @Body({ schema: useSystemMaterialSchema }) dto: UseSystemMaterial) {
    return this.materials.use(actor.id, dto);
  }

  @Get(':id/versions/:version')
  version(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('version', { schema: z.coerce.number().int().positive() }) version: number) {
    return this.materials.versionForTeacher(actor.id, id, version);
  }

  @Get(':id/versions/:version/media')
  async media(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('version', { schema: z.coerce.number().int().positive() }) version: number, @Res() res: Response) {
    sendMaterialFile(res, await this.materials.preview(actor.id, id, version));
  }
}
