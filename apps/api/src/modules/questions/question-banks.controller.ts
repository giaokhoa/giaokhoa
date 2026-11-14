import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { QuestionBanksService } from './question-banks.service';
import { BANK_KINDS, type BankKind } from '@giaokhoa/db/repositories/question-banks';
import { MatrixBanksService } from '../quiz/matrix-banks.service';
import {
  approveMatrixContributionSchema, rejectMatrixContributionSchema,
  type ApproveMatrixContributionDto, type RejectMatrixContributionDto,
} from '../quiz/dto/quiz.dto';
import {
  approveContributionSchema, createContributionSchema, createQuestionBankSchema, rejectContributionSchema,
  type ApproveContributionDto, type CreateContributionDto, type CreateQuestionBankDto, type RejectContributionDto,
} from './dto/questions.dto';

@ApiTags('question-banks')
@Controller({ path: 'question-banks', version: '1' })
export class QuestionBanksController {
  constructor(
    private readonly banks: QuestionBanksService,
    private readonly matrixBanks: MatrixBanksService,
  ) {}

  @Post()
  async create(@Body({ schema: createQuestionBankSchema }) dto: CreateQuestionBankDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.createBank(actor.id, dto);
  }
  @Get()
  async list(@Query('kind', { schema: z.enum(BANK_KINDS).optional() }) kind: BankKind | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.listBanks(actor.id, kind ?? 'question');
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.getBank(actor.id, id);
  }
  @Post(':id/contributions')
  async propose(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createContributionSchema }) dto: CreateContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.proposeContribution(actor.id, id, dto);
  }
  @Get(':id/contributions')
  async listContributions(@Param('id', { schema: uuidIdSchema }) id: string, @Query('status', { schema: z.string().trim().min(1).optional() }) status: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.listContributions(actor.id, id, status || undefined);
  }
  @Post(':id/contributions/:contributionId/approve')
  async approve(@Param('id', { schema: uuidIdSchema }) id: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: approveContributionSchema }) dto: ApproveContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.approveContribution(actor.id, id, contributionId, dto);
  }
  @Post(':id/contributions/:contributionId/reject')
  async reject(@Param('id', { schema: uuidIdSchema }) id: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: rejectContributionSchema }) dto: RejectContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banks.rejectContribution(actor.id, id, contributionId, dto.reason);
  }


  @Get('matrix-contributions/mine')
  async myContributions(@CurrentUser() actor: AuthenticatedUser) {
    return this.matrixBanks.listMyContributions(actor.id);
  }

  @Get(':bankId/matrices')
  async listMatrices(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.matrixBanks.listBankMatrices(actor.id, bankId);
  }

  @Get(':bankId/matrix-contributions')
  async listMatrixContributions(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Query('status', { schema: z.string().trim().min(1).optional() }) status: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.matrixBanks.listContributions(actor.id, bankId, status);
  }

  @Post(':bankId/matrix-contributions/:contributionId/approve')
  async approveMatrixContribution(
    @Param('bankId', { schema: uuidIdSchema }) bankId: string,
    @Param('contributionId', { schema: uuidIdSchema }) contributionId: string,
    @Body({ schema: approveMatrixContributionSchema }) _dto: ApproveMatrixContributionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.matrixBanks.approveContribution(actor.id, bankId, contributionId);
  }

  @Post(':bankId/matrix-contributions/:contributionId/reject')
  async rejectMatrixContribution(
    @Param('bankId', { schema: uuidIdSchema }) bankId: string,
    @Param('contributionId', { schema: uuidIdSchema }) contributionId: string,
    @Body({ schema: rejectMatrixContributionSchema }) dto: RejectMatrixContributionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.matrixBanks.rejectContribution(actor.id, bankId, contributionId, dto);
  }
}
