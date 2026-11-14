import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Res, UseInterceptors } from '@nestjs/common';
import { badRequest } from '../../common/http-errors';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
@Controller({ path: 'exam-papers', version: '1' })
@UseInterceptors(DeprecatedRouteAliasInterceptor)
export class ExamPapersAliasController {
  constructor(
    private readonly exams: ExamsService,
    private readonly dossiers: ExamDossiersService,
  ) {}

  @Get('banks/:bankId/exams')
  @ApiOperation({ operationId: 'examPapersAliasList' })
  async aliasList(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listPapers(actor.id, bankId);
  }

  @Post('banks/:bankId/exams')
  @ApiOperation({ operationId: 'examPapersAliasCreate' })
  async aliasCreate(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Body({ schema: createExamSchema }) dto: CreateExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.createPaper(actor.id, bankId, dto);
  }

  @Get('banks/:bankId/contributions')
  @ApiOperation({ operationId: 'examPapersAliasListContributions' })
  async aliasListContributions(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listContributions(actor.id, bankId);
  }

  @Post('banks/:bankId/contributions')
  @ApiOperation({ operationId: 'examPapersAliasPropose' })
  async aliasPropose(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Body({ schema: createExamContributionSchema }) dto: CreateExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.proposeContribution(actor.id, bankId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/approve')
  @ApiOperation({ operationId: 'examPapersAliasApprove' })
  async aliasApprove(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: approveExamContributionSchema }) dto: ApproveExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.approveContribution(actor.id, bankId, contributionId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/reject')
  @ApiOperation({ operationId: 'examPapersAliasReject' })
  async aliasReject(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: rejectExamContributionSchema }) dto: RejectExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.rejectContribution(actor.id, bankId, contributionId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/board-approve')
  @ApiOperation({ operationId: 'examPapersAliasBoardApprove' })
  async aliasBoardApprove(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: approveExamContributionSchema }) dto: ApproveExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.boardApproveContribution(actor.id, bankId, contributionId, dto);
  }

  @Post('banks/:bankId/contributions/:contributionId/board-reject')
  @ApiOperation({ operationId: 'examPapersAliasBoardReject' })
  async aliasBoardReject(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @Param('contributionId', { schema: uuidIdSchema }) contributionId: string, @Body({ schema: rejectExamContributionSchema }) dto: RejectExamContributionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.boardRejectContribution(actor.id, bankId, contributionId, dto);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'examPapersAliasGet' })
  async aliasGet(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.getPaper(actor.id, id);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'examPapersAliasUpdate' })
  async aliasUpdate(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateExamSchema }) dto: UpdateExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.updatePaper(actor.id, id, dto);
  }

  @Put(':id/slots')
  @ApiOperation({ operationId: 'examPapersAliasSetSlots' })
  async aliasSetSlots(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setExamSlotsSchema }) dto: SetExamSlotsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.setSlots(actor.id, id, dto);
  }

  @Post(':id/status')
  @ApiOperation({ operationId: 'examPapersAliasSetStatus' })
  async aliasSetStatus(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setExamStatusSchema }) dto: SetExamStatusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.setStatus(actor.id, id, dto);
  }

  @Post(':id/withdraw')
  @ApiOperation({ operationId: 'examPapersAliasWithdraw' })
  async aliasWithdraw(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: withdrawExamSchema }) dto: WithdrawExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.withdrawPaper(actor.id, id, dto);
  }

  @Post(':id/restore')
  @ApiOperation({ operationId: 'examPapersAliasRestore' })
  async aliasRestore(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.restorePaper(actor.id, id);
  }

  @Delete(':id')
  @ApiOperation({ operationId: 'examPapersAliasRemove' })
  async aliasRemove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.deletePaper(actor.id, id);
  }

  @Post(':id/copy')
  @ApiOperation({ operationId: 'examPapersAliasCopy' })
  async aliasCopy(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: copyExamSchema }) dto: CopyExamDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.copyPaper(actor.id, id, dto);
  }

  @Post(':id/swap')
  @ApiOperation({ operationId: 'examPapersAliasSwap' })
  async aliasSwap(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: swapExamSlotSchema }) dto: SwapExamSlotDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.swapSlot(actor.id, id, dto);
  }

  @Get(':id/pins')
  @ApiOperation({ operationId: 'examPapersAliasPins' })
  async aliasPins(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listPins(actor.id, id);
  }

  @Get(':id/specification')
  @ApiOperation({ operationId: 'examPapersAliasSpecification' })
  async aliasSpecification(@Param('id', { schema: uuidIdSchema }) id: string, @Query('pinId') pinId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    if (pinId !== undefined && !uuidIdSchema.safeParse(pinId).success) {
      badRequest('pinId must be a uuid', 'quiz.spec_quiz_invalid');
    }
    return this.exams.getPaperSpecification(actor.id, id, pinId);
  }

  @Get(':id/specification/export')
  @Header('content-disposition', 'attachment')
  @ApiOperation({ operationId: 'examPapersAliasExportSpecification' })
  async aliasExportSpecification(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Query('format') format: string | undefined,
    @Query('pinId') pinId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    if (pinId !== undefined && !uuidIdSchema.safeParse(pinId).success) {
      badRequest('pinId must be a uuid', 'quiz.spec_quiz_invalid');
    }
    const file = await this.exams.exportPaperSpecification(actor.id, id, format ?? 'xlsx', pinId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get(':id/print')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ operationId: 'examPapersAliasPrint' })
  async aliasPrint(@Param('id', { schema: uuidIdSchema }) id: string, @Query('pinId') pinId: string | undefined, @Query('variantCode') variantCode: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.exams.printPaperHtml(actor.id, id, pinId ?? '', variantCode ?? '');
  }

  @Get('dossiers/mine')
  @ApiOperation({ operationId: 'examPapersAliasListMine' })
  async aliasListMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.listMyDossiers(actor.id);
  }

  @Get('banks/:bankId/dossiers')
  @ApiOperation({ operationId: 'examPapersAliasListBankDossiers' })
  async aliasListBankDossiers(@Param('bankId', { schema: uuidIdSchema }) bankId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.listBankDossiers(actor.id, bankId);
  }

  @Get('dossiers/:dossierId')
  @ApiOperation({ operationId: 'examPapersAliasGetDossier' })
  async aliasGetDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.getDossier(actor.id, dossierId);
  }

  @Get('dossiers/:dossierId/specification')
  @ApiOperation({ operationId: 'examPapersAliasGetDossierSpecification' })
  async aliasGetDossierSpecification(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.getDossierSpecification(actor.id, dossierId);
  }

  @Get('dossiers/:dossierId/specification/export')
  @Header('content-disposition', 'attachment')
  @ApiOperation({ operationId: 'examPapersAliasExportDossierSpecification' })
  async aliasExportDossierSpecification(
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
  @ApiOperation({ operationId: 'examPapersAliasSubmitDossier' })
  async aliasSubmitDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.submitDossier(actor.id, dossierId);
  }

  @Delete('dossiers/:dossierId')
  @ApiOperation({ operationId: 'examPapersAliasDeleteDossier' })
  async aliasDeleteDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.deleteDossier(actor.id, dossierId);
  }

  @Post('dossiers/:dossierId/approve')
  @ApiOperation({ operationId: 'examPapersAliasApproveDossier' })
  async aliasApproveDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: approveExamDossierSchema }) _dto: ApproveExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.approveDossier(actor.id, dossierId);
  }

  @Post('dossiers/:dossierId/reject')
  @ApiOperation({ operationId: 'examPapersAliasRejectDossier' })
  async aliasRejectDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: rejectExamDossierSchema }) dto: RejectExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.rejectDossier(actor.id, dossierId, dto);
  }

  @Post('dossiers/:dossierId/board-approve')
  @ApiOperation({ operationId: 'examPapersAliasBoardApproveDossier' })
  async aliasBoardApproveDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: approveExamDossierSchema }) _dto: ApproveExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.boardApproveDossier(actor.id, dossierId);
  }

  @Post('dossiers/:dossierId/board-reject')
  @ApiOperation({ operationId: 'examPapersAliasBoardRejectDossier' })
  async aliasBoardRejectDossier(@Param('dossierId', { schema: uuidIdSchema }) dossierId: string, @Body({ schema: rejectExamDossierSchema }) dto: RejectExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.boardRejectDossier(actor.id, dossierId, dto);
  }

  @Post(':id/dossiers')
  @ApiOperation({ operationId: 'examPapersAliasCreateDossier' })
  async aliasCreateDossier(@Param('id', { schema: uuidIdSchema }) paperId: string, @Body({ schema: createExamDossierSchema }) dto: CreateExamDossierDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dossiers.createDossier(actor.id, paperId, dto);
  }
}
