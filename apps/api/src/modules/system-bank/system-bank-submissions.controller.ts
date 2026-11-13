import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { rejectSystemBankSubmissionSchema, submitSystemBankQuestionSchema, uuidIdSchema, type RejectSystemBankSubmission, type SubmitSystemBankQuestion } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemBankSubmissionsService } from './system-bank-submissions.service';

@Controller({ path: 'system-bank/submissions', version: '1' })
export class SystemBankSubmissionsController {
  constructor(private readonly submissions: SystemBankSubmissionsService) {}

  @Post()
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: submitSystemBankQuestionSchema }) dto: SubmitSystemBankQuestion,
  ) {
    return this.submissions.submit(actor.id, dto.questionId, dto.license);
  }

  @Get('mine')
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.submissions.listMine(actor.id);
  }

  @Get('sources')
  listSources(@CurrentUser() actor: AuthenticatedUser) {
    return this.submissions.listSources(actor.id);
  }

  @Get('pending')
  listPending(@CurrentUser() actor: AuthenticatedUser) {
    return this.submissions.listPending(actor.id);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.submissions.getForReview(actor.id, id);
  }

  @Get(':id/media/:hash')
  async reviewMedia(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('hash', { schema: z.string().regex(/^[0-9a-f]{64}$/) }) hash: string,
    @Res() res: Response,
  ) {
    const { data, mimeType } = await this.submissions.readReviewMedia(actor.id, id, hash);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }

  @Post(':id/approve')
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.submissions.approve(actor.id, id);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: rejectSystemBankSubmissionSchema }) dto: RejectSystemBankSubmission,
  ) {
    return this.submissions.reject(actor.id, id, dto.reason);
  }
}
