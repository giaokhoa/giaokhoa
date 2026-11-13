import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { clientIpOf } from '../../common/client-ip';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { QuizService } from '../quiz/quiz.service';
import {
  applyPinVersionUpdateSchema, createExamPinFeedbackSchema, createExamPinOverrideSchema, createExamPinSchema,
  gradeQuizQuestionSchema, regradePinQuestionSchema, startQuizAttemptSchema, updateExamPinOverrideSchema, updateExamPinSchema,
  type ApplyPinVersionUpdateDto, type CreateExamPinDto, type CreateExamPinFeedbackDto, type CreateExamPinOverrideDto,
  type GradeQuizQuestionDto, type RegradePinQuestionDto, type StartQuizAttemptDto, type UpdateExamPinDto, type UpdateExamPinOverrideDto,
} from '../quiz/dto/quiz.dto';
import { ExamsService } from './exams.service';

@ApiTags('exam-pins')
@Controller({ path: 'courses/:courseId/exam-pins', version: '1' })
export class CourseExamPinsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly quiz: QuizService,
  ) {}

  @Post()
  async create(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createExamPinSchema }) dto: CreateExamPinDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.createPin(actor.id, courseId, dto);
  }
  @Get()
  async list(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listPins(actor.id, courseId);
  }
}

@ApiTags('exam-pins')
@Controller({ path: 'exam-pins', version: '1' })
export class ExamPinsController {
  constructor(private readonly quiz: QuizService) {}

  @Get(':pinId')
  async getForUser(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getQuizForUser(actor.id, pinId);
  }
  @Patch(':pinId')
  async update(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: updateExamPinSchema }) dto: UpdateExamPinDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.updatePin(actor.id, pinId, dto);
  }
  @Delete(':pinId')
  async remove(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.quiz.deletePin(actor.id, pinId);
    return { deleted: true };
  }
  @Get(':pinId/version-update')
  async versionUpdatePreview(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getPinVersionUpdatePreview(actor.id, pinId);
  }
  @Post(':pinId/version-update')
  async applyVersionUpdate(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: applyPinVersionUpdateSchema }) dto: ApplyPinVersionUpdateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.applyPinVersionUpdate(actor.id, pinId, dto.toExamVersionId);
  }
  @Post(':pinId/regrades')
  async regrade(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: regradePinQuestionSchema }) dto: RegradePinQuestionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.regradePinQuestion(actor.id, pinId, dto);
  }
  @Get(':pinId/regrades')
  async listRegrades(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listPinRegrades(actor.id, pinId);
  }
  @Get(':pinId/my-regrades')
  async myRegrades(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listMyPinRegrades(actor.id, pinId);
  }
  @Post(':pinId/publish')
  async publish(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.publishResults(actor.id, pinId);
  }
  @Post(':pinId/unpublish')
  async unpublish(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.unpublishResults(actor.id, pinId);
  }
  @Get(':pinId/attempts')
  async listAttempts(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listAttemptSummaries(actor.id, pinId);
  }
  @Post(':pinId/attempts')
  async startAttempt(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: startQuizAttemptSchema }) dto: StartQuizAttemptDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.quiz.startAttempt(actor.id, pinId, { preview: dto.preview, password: dto.password, clientIp: clientIpOf(req) });
  }
  @Get(':pinId/results')
  async results(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.getResults(actor.id, pinId);
  }
  @Get(':pinId/grade-by-question/:questionId')
  async gradeByQuestionQueue(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Param('questionId', { schema: uuidIdSchema }) questionId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listQuestionGradingQueue(actor.id, pinId, questionId);
  }
  @Post(':pinId/grade-by-question')
  async gradeByQuestion(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: gradeQuizQuestionSchema }) dto: GradeQuizQuestionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.gradeQuestionForAttempts(actor.id, pinId, dto);
  }
  @Get(':pinId/overrides')
  async listOverrides(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listOverrides(actor.id, pinId);
  }
  @Post(':pinId/overrides')
  async createOverride(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: createExamPinOverrideSchema }) dto: CreateExamPinOverrideDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.createOverride(actor.id, pinId, dto);
  }
  @Get(':pinId/feedbacks')
  async listFeedbacks(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.listFeedbacks(actor.id, pinId);
  }
  @Post(':pinId/feedbacks')
  async createFeedback(@Param('pinId', { schema: uuidIdSchema }) pinId: string, @Body({ schema: createExamPinFeedbackSchema }) dto: CreateExamPinFeedbackDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.createFeedback(actor.id, pinId, dto);
  }
}

@ApiTags('exam-pins')
@Controller({ path: 'exam-pin-overrides', version: '1' })
export class ExamPinOverridesController {
  constructor(private readonly quiz: QuizService) {}

  @Patch(':overrideId')
  async update(@Param('overrideId', { schema: uuidIdSchema }) overrideId: string, @Body({ schema: updateExamPinOverrideSchema }) dto: UpdateExamPinOverrideDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quiz.updatePinOverride(actor.id, overrideId, dto);
  }
  @Delete(':overrideId')
  async remove(@Param('overrideId', { schema: uuidIdSchema }) overrideId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.quiz.deletePinOverride(actor.id, overrideId);
    return { deleted: true };
  }
}

@ApiTags('exam-pins')
@Controller({ path: 'exam-pin-feedbacks', version: '1' })
export class ExamPinFeedbacksController {
  constructor(private readonly quiz: QuizService) {}

  @Delete(':feedbackId')
  async remove(@Param('feedbackId', { schema: uuidIdSchema }) feedbackId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.quiz.deletePinFeedback(actor.id, feedbackId);
    return { deleted: true };
  }
}
