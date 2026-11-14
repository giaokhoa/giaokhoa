import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { cognitiveLevelSchema, uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { QuestionBanksService } from './question-banks.service';
import { QuestionsService } from './questions.service';
import { attachQuestionOutcomeSchema, attachQuestionSubjectSchema, copyQuestionSchema, copyQuestionsBatchSchema, createQuestionCategorySchema, createQuestionSchema, createQuestionUsageSchema, createStimulusSchema, setQuestionStatusSchema, submitQuestionResponseSchema, updateQuestionOutcomeLinkSchema, updateQuestionSchema, updateStimulusSchema, withdrawQuestionSchema, type AttachQuestionOutcomeDto, type AttachQuestionSubjectDto, type CopyQuestionDto, type CopyQuestionsBatchDto, type CreateQuestionCategoryDto, type CreateQuestionDto, type CreateStimulusDto, type CreateUsageDto, type SetQuestionStatusDto, type SubmitResponseDto, type UpdateQuestionDto, type UpdateQuestionOutcomeLinkDto, type UpdateStimulusDto, type WithdrawQuestionDto } from './dto/questions.dto';

@ApiTags('questions')
@Controller({ path: 'questions', version: '1' })
export class QuestionsController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly banks: QuestionBanksService,
  ) {}

  @Post('categories')
  async createCategory(@Body({ schema: createQuestionCategorySchema }) dto: CreateQuestionCategoryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.createCategory(actor.id, dto);
  }
  @Get('categories')
  async listCategories(@Query('contextId', { schema: uuidIdSchema.optional() }) contextId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.listCategoriesForViewer(actor.id, contextId || undefined);
  }
  @Get('categories/:id/questions')
  async listQuestions(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.listQuestionsForViewer(actor.id, id);
  }
  @Post()
  async create(@Body({ schema: createQuestionSchema }) dto: CreateQuestionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.createQuestion(actor.id, dto);
  }
  @Get()
  async listByCurriculumFilter(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('subjectId', { schema: uuidIdSchema.optional() }) subjectId?: string,
    @Query('outcomeId', { schema: uuidIdSchema.optional() }) outcomeId?: string,
    @Query('cognitiveLevel', { schema: cognitiveLevelSchema.optional() }) cognitiveLevel?: string,
    @Query('qtype', { schema: z.string().trim().min(1).optional() }) qtype?: string,
    @Query('status', { schema: z.string().trim().min(1).optional() }) status?: string,
  ) {
    return this.questions.listQuestionsByCurriculumFilterForViewer(actor.id, {
      subjectId: subjectId || undefined,
      outcomeId: outcomeId || undefined,
      cognitiveLevel: cognitiveLevel || undefined,
      qtype: qtype || undefined,
      status: status || undefined,
    });
  }
  @Get('discovery')
  async discover(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('bankId', { schema: uuidIdSchema.optional() }) bankId?: string,
    @Query('subjectId', { schema: uuidIdSchema.optional() }) subjectId?: string,
    @Query('nodeId', { schema: uuidIdSchema.optional() }) nodeId?: string,
    @Query('outcomeId', { schema: uuidIdSchema.optional() }) outcomeId?: string,
    @Query('cognitiveLevel', { schema: cognitiveLevelSchema.optional() }) cognitiveLevel?: string,
    @Query('qtype', { schema: z.string().trim().min(1).optional() }) qtype?: string,
    @Query('keyword', { schema: z.string().trim().min(1).optional() }) keyword?: string,
    @Query('authorId', { schema: uuidIdSchema.optional() }) authorId?: string,
  ) {
    return this.banks.discover(actor.id, {
      bankId: bankId || undefined,
      subjectId: subjectId || undefined,
      nodeId: nodeId || undefined,
      outcomeId: outcomeId || undefined,
      cognitiveLevel: cognitiveLevel || undefined,
      qtype: qtype || undefined,
      keyword: keyword || undefined,
      authorId: authorId || undefined,
    });
  }
  @Post('copy-batch')
  async copyBatch(@Body({ schema: copyQuestionsBatchSchema }) dto: CopyQuestionsBatchDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.copyQuestionsBatch(actor.id, dto);
  }
  @Get(':id/curriculum-links')
  async getCurriculumLinks(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.getCurriculumLinksForViewer(actor.id, id);
  }
  @Post(':id/subjects')
  async attachSubject(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: attachQuestionSubjectSchema }) dto: AttachQuestionSubjectDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.attachSubject(actor.id, id, dto.subjectId);
  }
  @Delete(':id/subjects/:subjectId')
  async detachSubject(@Param('id', { schema: uuidIdSchema }) id: string, @Param('subjectId', { schema: uuidIdSchema }) subjectId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.detachSubject(actor.id, id, subjectId);
  }
  @Post(':id/outcomes')
  async attachOutcome(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: attachQuestionOutcomeSchema }) dto: AttachQuestionOutcomeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.attachOutcome(actor.id, id, dto.outcomeId, dto.cognitiveLevel);
  }
  @Patch(':id/outcomes/:outcomeId')
  async updateOutcomeLink(@Param('id', { schema: uuidIdSchema }) id: string, @Param('outcomeId', { schema: uuidIdSchema }) outcomeId: string, @Body({ schema: updateQuestionOutcomeLinkSchema }) dto: UpdateQuestionOutcomeLinkDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.updateOutcomeLink(actor.id, id, outcomeId, dto.cognitiveLevel);
  }
  @Delete(':id/outcomes/:outcomeId')
  async detachOutcome(@Param('id', { schema: uuidIdSchema }) id: string, @Param('outcomeId', { schema: uuidIdSchema }) outcomeId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.detachOutcome(actor.id, id, outcomeId);
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.getQuestionForViewer(actor.id, id);
  }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateQuestionSchema }) dto: UpdateQuestionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.updateQuestion(actor.id, id, dto);
  }
  @Post(':id/copy')
  async copy(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: copyQuestionSchema }) dto: CopyQuestionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.copyQuestion(actor.id, id, dto);
  }
  @Get(':id/attribution')
  async attribution(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.getAttributionForViewer(actor.id, id);
  }
  @Get(':id/containing-exams')
  async containingExams(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.listContainingExams(actor.id, id);
  }
  @Post(':id/withdraw')
  async withdraw(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: withdrawQuestionSchema }) dto: WithdrawQuestionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.withdrawQuestion(actor.id, id, dto.reason);
  }
  @Post(':id/restore')
  async restore(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.restoreQuestion(actor.id, id);
  }
  @Post(':id/status')
  async setStatus(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setQuestionStatusSchema }) dto: SetQuestionStatusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.setQuestionStatusForActor(actor.id, id, dto.status);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.deleteQuestion(actor.id, id);
  }
  @Get(':id/versions')
  async versions(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.listVersionsForViewer(actor.id, id);
  }
}

@ApiTags('stimuli')
@Controller({ path: 'stimuli', version: '1' })
export class StimuliController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  async create(@Body({ schema: createStimulusSchema }) dto: CreateStimulusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.createStimulus(actor.id, dto);
  }
  @Get()
  async list(@Query('categoryId', { schema: uuidIdSchema }) categoryId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.listStimuliForViewer(actor.id, categoryId);
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.getStimulusForViewer(actor.id, id);
  }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateStimulusSchema }) dto: UpdateStimulusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.updateStimulus(actor.id, id, dto);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.deleteStimulus(actor.id, id);
    return { deleted: true };
  }
}

@ApiTags('question-engine')
@Controller({ path: 'question-usages', version: '1' })
export class QuestionUsagesController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  async create(@Body({ schema: createQuestionUsageSchema }) dto: CreateUsageDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.assertCanCreateUsage(actor.id, dto.slots.map((s) => s.questionId));
    return this.questions.createUsage(actor.id, dto);
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.questions.getUsageForViewer(actor.id, id);
  }
  @Post(':id/start')
  async start(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.assertUsageManipulableViaHttp(actor.id, id);
    return this.questions.startUsage(actor.id, id);
  }
  @Post(':id/finish')
  async finish(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.assertUsageManipulableViaHttp(actor.id, id);
    return this.questions.finishUsage(actor.id, id);
  }
  @Post(':id/attempts/:attemptId/start')
  async startAttempt(@Param('id', { schema: uuidIdSchema }) id: string, @Param('attemptId', { schema: uuidIdSchema }) attemptId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.assertAttemptManipulableViaHttp(actor.id, id, attemptId);
    return this.questions.startAttempt(actor.id, attemptId);
  }
  @Post(':id/attempts/:attemptId/submit')
  async submit(@Param('id', { schema: uuidIdSchema }) id: string, @Param('attemptId', { schema: uuidIdSchema }) attemptId: string, @Body({ schema: submitQuestionResponseSchema }) dto: SubmitResponseDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.assertAttemptManipulableViaHttp(actor.id, id, attemptId);
    return this.questions.submitResponse(actor.id, attemptId, dto.response ?? null);
  }
  @Post(':id/attempts/:attemptId/finish')
  async finishAttempt(@Param('id', { schema: uuidIdSchema }) id: string, @Param('attemptId', { schema: uuidIdSchema }) attemptId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.questions.assertAttemptManipulableViaHttp(actor.id, id, attemptId);
    return this.questions.finishAttempt(actor.id, attemptId);
  }
}
