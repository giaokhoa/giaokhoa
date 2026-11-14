import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { FilesService, QUESTION_IMAGE_MAX_BYTES, questionFileContentSrc, resolveGenericUploadMimeType, sniffMimeType } from './files.service';
import { questionImageMetaServerSchema, uploadMetaServerSchema, type QuestionImageMetaDto, type UploadMetaDto } from './dto/files.dto';

export const GENERIC_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;


@ApiTags('files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: GENERIC_UPLOAD_MAX_BYTES } }))
  async upload(@UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string } | undefined, @Body({ schema: uploadMetaServerSchema }) meta: UploadMetaDto, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException({ message: 'A file is required in the multipart field "file"', code: 'file_required' });
    }
    await this.files.assertCanUpload(meta.contextId, actor);
    const row = await this.files.upload({
      contextId: meta.contextId, component: meta.component, fileArea: meta.fileArea,
      itemId: meta.itemId, filePath: meta.filePath,
      fileName: file.originalname, data: file.buffer, mimeType: resolveGenericUploadMimeType(file.originalname, file.buffer, file.mimetype), userId: actor.id,
    });
    return { id: row.id, contentHash: row.contentHash, fileSize: row.fileSize, fileName: row.fileName, contextId: row.contextId };
  }

  @Post('question-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: QUESTION_IMAGE_MAX_BYTES } }))
  async uploadQuestionImage(@UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string } | undefined, @Body({ schema: questionImageMetaServerSchema }) meta: QuestionImageMetaDto, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException({ message: 'A file is required in the multipart field "file"', code: 'file_required' });
    }
    await this.files.assertCanUpload(meta.contextId, actor);
    const row = await this.files.uploadQuestionImage({
      contextId: meta.contextId, fileArea: meta.fileArea, itemId: meta.itemId,
      fileName: file.originalname, data: file.buffer, userId: actor.id,
    });
    return {
      id: row.id, src: questionFileContentSrc(row.id), fileName: row.fileName,
      mimeType: row.mimeType, fileSize: row.fileSize, contextId: row.contextId, fileArea: row.fileArea,
    };
  }

  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    const f = await this.files.getFile(id);
    await this.files.assertCanView(f, actor);
    return { id: f.id, contentHash: f.contentHash, fileSize: f.fileSize, fileName: f.fileName, contextId: f.contextId, component: f.component, fileArea: f.fileArea, mimeType: f.mimeType };
  }

  @Post(':id/signed-url')
  async signedUrl(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.files.createSignedUrl(id, actor.id, actor.username === 'guest');
  }

  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    const f = await this.files.getFile(id);
    await this.files.assertCanUpload(f.contextId, actor);
    return this.files.deleteFile(id, actor);
  }

  @Public()
  @Get(':id/download')
  async download(@Param('id', { schema: uuidIdSchema }) id: string, @Query('sig', { schema: z.string().trim().min(1).optional() }) sig: string | undefined, @Res() res: Response) {
    const { file, data } = await this.files.readSignedContent(id, sig);
    res.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(data);
  }

  @Get(':id/content')
  async content(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    const probe = await this.files.getFile(id);
    await this.files.createSignedUrl(id, actor.id, actor.username === 'guest');
    void probe;
    const { file, data } = await this.files.readContent(id);
    const safeInline = (file.mimeType === 'image/png' || file.mimeType === 'image/jpeg' || file.mimeType === 'image/webp' || file.mimeType === 'image/gif')
      && sniffMimeType(data) === file.mimeType;
    res.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream');
    if (!safeInline) {
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'none'");
    }
    res.send(data);
  }
}
