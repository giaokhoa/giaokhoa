import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Res, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { ExamDossiersService } from './exam-dossiers.service';
import { ExamsService } from './exams.service';
import {
  approveExamContributionSchema, approveExamDossierSchema, copyExamSchema, createExamContributionSchema,
  createExamDossierSchema, createExamSchema, rejectExamContributionSchema, rejectExamDossierSchema,
  setExamSlotsSchema, setExamStatusSchema, swapExamSlotSchema, updateExamSchema,
  withdrawExamSchema,
  type ApproveExamContributionDto, type ApproveExamDossierDto, type CopyExamDto, type CreateExamContributionDto,
  type CreateExamDossierDto, type CreateExamDto, type RejectExamContributionDto, type RejectExamDossierDto,
  type SetExamSlotsDto, type SetExamStatusDto, type SwapExamSlotDto, type UpdateExamDto,
  type WithdrawExamDto,
} from './dto/exams.dto';

@ApiTags('exams')
@Controller({ path: 'exams', version: '1' })
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly dossiers: ExamDossiersService,
  ) {}

  @Get('banks/:bankId/exams')
  async list(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listPapers(actor.id, bankId);
  }

  @Post('banks/:bankId/exams')
  async create(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Body({ schema: createExamSchema }) dto: CreateExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.createPaper(actor.id, bankId, dto);
  }

  @Get('banks/:bankId/contributions')
  async listContributions(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listContributions(actor.id, bankId);
  }

  @Post('banks/:bankId/contributions')
  async propose(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Body({ schema: createExamContributionSchema }) dto: CreateExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.proposeContribution(actor.id, bankId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/approve')
  async approve(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: approveExamContributionSchema }) dto: ApproveExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.approveContribution(actor.id, bankId, contributionId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/reject')
  async reject(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: rejectExamContributionSchema }) dto: RejectExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.rejectContribution(actor.id, bankId, contributionId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/board-approve')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async boardApprove(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: approveExamContributionSchema }) dto: ApproveExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.boardApproveContribution(actor.id, bankId, contributionId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/board-reject')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async boardReject(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: rejectExamContributionSchema }) dto: RejectExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.boardRejectContribution(actor.id, bankId, contributionId, dto);
  }

  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.getPaper(actor.id, id);
  }

  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateExamSchema }) dto: UpdateExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.updatePaper(actor.id, id, dto);
  }

  @Put(':id/slots')
  async setSlots(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setExamSlotsSchema }) dto: SetExamSlotsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.setSlots(actor.id, id, dto);
  }

  @Post(':id/status')
  async setStatus(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setExamStatusSchema }) dto: SetExamStatusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.setStatus(actor.id, id, dto);
  }

  @Post(':id/withdraw')
  async withdraw(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: withdrawExamSchema }) dto: WithdrawExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.withdrawPaper(actor.id, id, dto);
  }

  @Post(':id/restore')
  async restore(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.restorePaper(actor.id, id);
  }

  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.deletePaper(actor.id, id);
  }

  @Post(':id/copy')
  async copy(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: copyExamSchema }) dto: CopyExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.copyPaper(actor.id, id, dto);
  }

  @Post(':id/swap')
  async swap(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: swapExamSlotSchema }) dto: SwapExamSlotDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.swapSlot(actor.id, id, dto);
  }

  @Get(':id/pins')
  async pins(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listPins(actor.id, id);
  }

  @Get(':id/specification')
  async specification(@Param('id', { schema: uuidIdSchema }) id: string, @Query('pinId') pinId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    if (pinId !== undefined && !uuidIdSchema.safeParse(pinId).success) {
      throw new BadRequestException({ message: 'pinId must be a uuid', code: 'quiz.spec_quiz_invalid' });
    }
    return this.exams.getPaperSpecification(actor.id, id, pinId);
  }

  @Get(':id/specification/export')
  @Header('content-disposition', 'attachment')
  async exportSpecification(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Query('format') format: string | undefined,
    @Query('pinId') pinId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    if (pinId !== undefined && !uuidIdSchema.safeParse(pinId).success) {
      throw new BadRequestException({ message: 'pinId must be a uuid', code: 'quiz.spec_quiz_invalid' });
    }
    const file = await this.exams.exportPaperSpecification(actor.id, id, format ?? 'xlsx', pinId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get(':id/print')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async print(@Param('id', { schema: uuidIdSchema }) id: string, @Query('pinId') pinId: string | undefined, @Query('variantCode') variantCode: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.printPaperHtml(actor.id, id, pinId ?? '', variantCode ?? '');
  }


  @Get('dossiers/mine')
  async listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.listMyDossiers(actor.id);
  }

  @Get('banks/:bankId/dossiers')
  async listBankDossiers(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.listBankDossiers(actor.id, bankId);
  }

  @Get('dossiers/:dossierId')
  async getDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.getDossier(actor.id, dossierId);
  }

  @Get('dossiers/:dossierId/specification')
  async getDossierSpecification(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.getDossierSpecification(actor.id, dossierId);
  }

  @Get('dossiers/:dossierId/specification/export')
  @Header('content-disposition', 'attachment')
  async exportDossierSpecification(
    @Param('dossierId', { schema: uuidIdSchema }) dossierId: string,
    @Query('format') format: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const file = await this.dossiers.exportDossierSpecification(actor.id, dossierId, format ?? 'xlsx');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Post('dossiers/:dossierId/submit')
  async submitDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.submitDossier(actor.id, dossierId);
  }

  @Delete('dossiers/:dossierId')
  async deleteDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.deleteDossier(actor.id, dossierId);
  }

  @Post('dossiers/:dossierId/approve')
  async approveDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: approveExamDossierSchema }) _dto: ApproveExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.approveDossier(actor.id, dossierId);
  }

  @Post('dossiers/:dossierId/reject')
  async rejectDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: rejectExamDossierSchema }) dto: RejectExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.rejectDossier(actor.id, dossierId, dto);
  }

  @Post('dossiers/:dossierId/board-approve')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async boardApproveDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: approveExamDossierSchema }) _dto: ApproveExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.boardApproveDossier(actor.id, dossierId);
  }

  @Post('dossiers/:dossierId/board-reject')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async boardRejectDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: rejectExamDossierSchema }) dto: RejectExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.boardRejectDossier(actor.id, dossierId, dto);
  }

  @Post(':id/dossiers')
  async createDossier(@Param('id', { schema: uuidIdSchema }) paperId: string, @Body({ schema: createExamDossierSchema }) dto: CreateExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.createDossier(actor.id, paperId, dto);
  }
}
