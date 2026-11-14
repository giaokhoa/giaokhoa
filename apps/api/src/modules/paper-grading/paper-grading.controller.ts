import { Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { badRequest } from '../../common/http-errors';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { uuidIdSchema } from '@giaokhoa/contracts';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import {
  assignPaperBatchSchema, assignPaperIdentitySchema, createPaperBatchSchema, resolvePaperReadingsSchema,
  type AssignPaperBatch, type AssignPaperIdentity, type CreatePaperBatch, type ResolvePaperReadings,
} from './dto/paper-grading.dto';
import { PaperGradingService } from './paper-grading.service';

export const PAPER_UPLOAD_MAX_FILES = 24;
export const PAPER_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

@ApiTags('paper-grading')
@Controller({ path: 'exam-batches', version: '1' })
export class ExamBatchesController {
  constructor(private readonly paper: PaperGradingService) {}

  @Post()
  async create(
    @Query('pinId', { schema: uuidIdSchema }) pinId: string,
    @Body({ schema: createPaperBatchSchema }) dto: CreatePaperBatch,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.createBatch(actor.id, pinId, dto);
  }

  @Get()
  async list(@Query('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.paper.listBatches(actor.id, pinId);
  }

  @Get(':batchId')
  async get(
    @Param('batchId', { schema: uuidIdSchema }) batchId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.getBatch(actor.id, batchId);
  }

  @Get(':batchId/sheets')
  async sheets(
    @Param('batchId', { schema: uuidIdSchema }) batchId: string,
    @Query('format') format: string | undefined,
    @Query('studentId') studentId: string | undefined,
    @Query('kind') kind: string | undefined,
    @Query('copies') copies: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    if (format !== undefined && format !== 'pdf') {
      badRequest(`Unsupported sheets format ${format}`, 'paper.sheets_format_unsupported');
    }
    const { buffer, fileName } = await this.paper.sheetsPdf(actor.id, batchId, {
      studentId, kind, copies: copies ? Number(copies) : undefined,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post(':batchId/scans')
  @UseInterceptors(FilesInterceptor('files', PAPER_UPLOAD_MAX_FILES, {
    limits: { fileSize: PAPER_UPLOAD_MAX_BYTES },
  }))
  async uploadScans(
    @Param('batchId', { schema: uuidIdSchema }) batchId: string,
    @UploadedFiles() files: { originalname: string; buffer: Buffer; mimetype: string }[],
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.uploadScans(actor.id, batchId, files ?? []);
  }
}

@ApiTags('paper-grading')
@Controller({ path: 'exam-scans', version: '1' })
export class ExamScansController {
  constructor(private readonly paper: PaperGradingService) {}

  @Post()
  @UseInterceptors(FilesInterceptor('files', PAPER_UPLOAD_MAX_FILES, {
    limits: { fileSize: PAPER_UPLOAD_MAX_BYTES },
  }))
  async uploadSession(
    @Query('pinId', { schema: uuidIdSchema }) pinId: string,
    @UploadedFiles() files: { originalname: string; buffer: Buffer; mimetype: string }[],
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.uploadSessionScans(actor.id, pinId, files ?? []);
  }

  @Get()
  async list(
    @Query('pinId', { schema: uuidIdSchema }) pinId: string,
    @Query('status') status: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.listScans(actor.id, pinId, status);
  }

  @Get(':scanId')
  async get(@Param('scanId', { schema: uuidIdSchema }) scanId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.paper.getScan(actor.id, scanId);
  }

  @Get(':scanId/image/:kind')
  async image(
    @Param('scanId', { schema: uuidIdSchema }) scanId: string,
    @Param('kind') kind: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { data, mimeType, fileName } = await this.paper.scanImage(actor.id, scanId, kind);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(data);
  }

  @Post(':scanId/assign-identity')
  async assignIdentity(
    @Param('scanId', { schema: uuidIdSchema }) scanId: string,
    @Body({ schema: assignPaperIdentitySchema }) dto: AssignPaperIdentity,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.assignIdentity(actor.id, scanId, dto.studentId);
  }

  @Post(':scanId/assign-batch')
  async assignBatch(
    @Param('scanId', { schema: uuidIdSchema }) scanId: string,
    @Body({ schema: assignPaperBatchSchema }) dto: AssignPaperBatch,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.assignBatch(actor.id, scanId, dto.batchId);
  }

  @Post(':scanId/resolve-readings')
  async resolveReadings(
    @Param('scanId', { schema: uuidIdSchema }) scanId: string,
    @Body({ schema: resolvePaperReadingsSchema }) dto: ResolvePaperReadings,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paper.resolveReadings(actor.id, scanId, dto);
  }

  @Post(':scanId/record')
  async record(@Param('scanId', { schema: uuidIdSchema }) scanId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.paper.recordScan(actor.id, scanId);
  }

  @Delete(':scanId')
  async remove(@Param('scanId', { schema: uuidIdSchema }) scanId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.paper.deleteScan(actor.id, scanId);
    return { deleted: true };
  }
}
