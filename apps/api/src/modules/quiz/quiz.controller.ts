import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { clientIpOf } from '../../common/client-ip';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { QuizService } from './quiz.service';
import { MatrixBanksService } from './matrix-banks.service';
import { MatrixImportService } from './matrix-import.service';
import { ExamsService } from '../exams/exams.service';
import {
  copyExamMatrixSchema, createExamMatrixCellSchema, createExamMatrixSchema, createMatrixContributionSchema,
  generateFromMatrixSchema, manualGradeQuizSchema,
  recordQuizAttemptEventSchema, submitQuizResponseSchema, updateExamMatrixCellSchema, updateExamMatrixSchema,
  withdrawExamMatrixSchema,
  type CopyExamMatrixDto, type CreateExamMatrixCellDto, type CreateExamMatrixDto, type CreateMatrixContributionDto,
  type GenerateFromMatrixDto, type ManualGradeQuizDto,
  type RecordQuizAttemptEventDto, type SubmitQuizResponseDto, type UpdateExamMatrixCellDto, type UpdateExamMatrixDto,
  type WithdrawExamMatrixDto,
} from './dto/quiz.dto';


@ApiTags('exam-matrices')
@Controller({ path: 'exam-matrices', version: '1' })
export class ExamMatricesController {
  constructor(
    private readonly quiz: QuizService,
    private readonly matrixImport: MatrixImportService,
    private readonly matrixBanks: MatrixBanksService,
    private readonly exams: ExamsService,
  ) {}

  @Post()
  async create(@Body({ schema: createExamMatrixSchema }) dto: CreateExamMatrixDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.createMatrix(actor.id, dto);
  }
  @Get('template')
  async template(@Query('subjectId', { schema: uuidIdSchema }) subjectId: string, @Query('curriculumId', { schema: uuidIdSchema }) curriculumId: string, @Query('levelSet', { schema: z.enum(['three', 'four']).optional() }) levelSet: string | undefined, @Query('scopeNodeIds', { schema: z.string().trim().min(1).optional() }) scopeNodeIds: string | undefined, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    let scope: string[] | null = null;
    if (scopeNodeIds) {
      scope = scopeNodeIds.split(',').map((x) => x.trim()).filter((x) => x !== '');
      if (scope.some((x) => !uuidIdSchema.safeParse(x).success)) {
        throw new BadRequestException({ message: 'scopeNodeIds must be a comma-separated list of uuids', code: 'quiz.matrix_import_query_invalid' });
      }
    }
    const { filename, contentType, buffer } = await this.matrixImport.buildTemplate(actor.id, {
      subjectId, curriculumId, levelSet: levelSet as 'three' | 'four' | undefined, scopeNodeIds: scope,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
  @Post('import/preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importPreview(@UploadedFile() file: { buffer: Buffer } | undefined, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException({ message: 'An .xlsx file is required in the multipart field "file"', code: 'quiz.matrix_import_file_required' });
    }
    return this.matrixImport.previewImport(actor.id, file.buffer);
  }
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importCommit(@UploadedFile() file: { buffer: Buffer } | undefined, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException({ message: 'An .xlsx file is required in the multipart field "file"', code: 'quiz.matrix_import_file_required' });
    }
    return this.matrixImport.commitImport(actor.id, file.buffer);
  }
  @Get('by-subject/:subjectId')
  async listBySubject(@Param('subjectId', { schema: uuidIdSchema }) subjectId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listMatrices(actor.id, subjectId);
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getMatrix(actor.id, id);
  }
  @Get(':id/versions/:version')
  async getVersion(@Param('id', { schema: uuidIdSchema }) id: string, @Param('version', { schema: z.coerce.number().int().positive() }) version: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getMatrixVersion(actor.id, id, version);
  }
  @Get(':id/generated-exams')
  async generatedExams(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listGeneratedExams(actor.id, id);
  }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateExamMatrixSchema }) dto: UpdateExamMatrixDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.updateMatrix(actor.id, id, dto);
  }
  @Post(':id/withdraw')
  async withdraw(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: withdrawExamMatrixSchema }) dto: WithdrawExamMatrixDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.withdrawMatrix(actor.id, id, dto);
  }
  @Post(':id/restore')
  async restore(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.restoreMatrix(actor.id, id);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.quiz.deleteMatrix(actor.id, id);
    return { deleted: true };
  }
  @Post(':id/cells')
  async addCell(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createExamMatrixCellSchema }) dto: CreateExamMatrixCellDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.createMatrixCell(actor.id, id, dto);
  }
  @Patch(':id/cells/:cellId')
  async updateCell(@Param('id', { schema: uuidIdSchema }) id: string, @Param('cellId', { schema: uuidIdSchema }) cellId: string, @Body({ schema: updateExamMatrixCellSchema }) dto: UpdateExamMatrixCellDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.updateMatrixCell(actor.id, id, cellId, dto);
  }
  @Delete(':id/cells/:cellId')
  async removeCell(@Param('id', { schema: uuidIdSchema }) id: string, @Param('cellId', { schema: uuidIdSchema }) cellId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.deleteMatrixCell(actor.id, id, cellId);
  }
  @Get(':id/availability')
  async availability(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.matrixAvailability(actor.id, id);
  }
  @Post(':id/generate')
  async generate(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: generateFromMatrixSchema }) dto: GenerateFromMatrixDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.generateFromMatrix(actor.id, id, dto);
  }
  @Get(':id/specification')
  async specification(@Param('id', { schema: uuidIdSchema }) id: string, @Query('pinId', { schema: uuidIdSchema.optional() }) pinId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getMatrixSpecification(actor.id, id, pinId);
  }
  @Get(':id/specification/export')
  async exportSpecification(@Param('id', { schema: uuidIdSchema }) id: string, @Query('format', { schema: z.string().trim().min(1).optional() }) format: string | undefined, @Query('pinId', { schema: uuidIdSchema.optional() }) pinId: string | undefined, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    const { filename, contentType, buffer } = await this.quiz.exportMatrixSpecification(actor.id, id, format ?? 'xlsx', pinId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }


  @Get(':id/attribution')
  async attribution(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.matrixBanks.getAttribution(actor.id, id);
  }

  @Post(':id/copy')
  async copy(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: copyExamMatrixSchema }) dto: CopyExamMatrixDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.matrixBanks.copyMatrix(actor.id, id, dto);
  }

  @Post(':id/contributions')
  async propose(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createMatrixContributionSchema }) dto: CreateMatrixContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.matrixBanks.proposeContribution(actor.id, id, dto);
  }
}

@ApiTags('quiz-attempts')
@Controller({ path: 'quiz-attempts', version: '1' })
export class QuizAttemptsController {
  constructor(private readonly quiz: QuizService) {}

  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getAttemptView(actor.id, id);
  }
  @Post(':id/responses')
  async respond(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: submitQuizResponseSchema }) dto: SubmitQuizResponseDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.quiz.submitResponse(actor.id, id, dto, clientIpOf(req));
  }
  @Post(':id/submit')
  async submit(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.submitAttempt(actor.id, id);
  }
  @Post(':id/questions/:questionAttemptId/grade')
  async grade(@Param('id', { schema: uuidIdSchema }) id: string, @Param('questionAttemptId', { schema: uuidIdSchema }) questionAttemptId: string, @Body({ schema: manualGradeQuizSchema }) dto: ManualGradeQuizDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.manualGrade(actor.id, id, { questionAttemptId, mark: dto.mark, comment: dto.comment });
  }
  @Post(':id/events')
  async recordEvent(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: recordQuizAttemptEventSchema }) dto: RecordQuizAttemptEventDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.recordAttemptEvent(actor.id, id, dto);
  }
  @Get(':id/events')
  async listEvents(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listAttemptEvents(actor.id, id);
  }
}
