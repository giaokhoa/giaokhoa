import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { rejectSystemExamSchema, submitSystemExamSchema, withdrawSystemResourceSchema, uuidIdSchema, type RejectSystemExam, type SubmitSystemExam, type WithdrawSystemResource } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemSharedExamsService } from './system-shared-exams.service';

@Controller({ path: 'system-bank/exams', version: '1' })
export class SystemSharedExamsController {
  constructor(private readonly exams: SystemSharedExamsService) {}

  @Get()
  published(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('courseId', { schema: uuidIdSchema }) courseId: string,
  ) {
    return this.exams.listPublished(actor.id, courseId);
  }

  @Post()
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: submitSystemExamSchema }) body: SubmitSystemExam,
  ) {
    return this.exams.submit(actor.id, body.examId);
  }

  @Get('mine')
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listMine(actor.id);
  }

  @Get('used')
  used(@CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listUsed(actor.id);
  }

  @Get('approved')
  approved(@CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listApprovedForReview(actor.id);
  }

  @Get('pending')
  pending(@CurrentUser() actor: AuthenticatedUser) {
    return this.exams.listPending(actor.id);
  }

  @Get(':id')
  review(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.exams.getReview(actor.id, id);
  }

  @Get(':id/media/:hash')
  async media(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('hash', { schema: z.string().regex(/^[0-9a-f]{64}$/) }) hash: string,
    @Res() res: Response,
  ) {
    const result = await this.exams.reviewMedia(actor.id, id, hash);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.data);
  }

  @Post(':id/approve')
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.exams.approve(actor.id, id);
  }

  @Post(':id/fork')
  fork(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.exams.fork(actor.id, id);
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: withdrawSystemResourceSchema }) body: WithdrawSystemResource) {
    return this.exams.withdraw(actor.id, id, body.reason);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: rejectSystemExamSchema }) body: RejectSystemExam,
  ) {
    return this.exams.reject(actor.id, id, body.reason);
  }
}
