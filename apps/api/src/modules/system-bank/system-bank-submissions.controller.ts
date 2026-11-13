/**
 * Bề mặt HTTP của luồng gửi–duyệt câu hỏi chung (#13).
 * Mỗi route gắn actor từ phiên đăng nhập; kiểm tra vai thực hiện trong
 * service trước khi đọc nội dung gói có đáp án.
 */
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { rejectSystemBankSubmissionSchema, submitSystemBankQuestionSchema, uuidIdSchema, type RejectSystemBankSubmission, type SubmitSystemBankQuestion } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemBankSubmissionsService } from './system-bank-submissions.service';

@Controller({ path: 'system-bank/submissions', version: '1' })
export class SystemBankSubmissionsController {
  constructor(private readonly submissions: SystemBankSubmissionsService) {}

  /** Quản trị trung tâm chụp phiên bản hiện tại vào hàng chờ. */
  @Post()
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: submitSystemBankQuestionSchema }) dto: SubmitSystemBankQuestion,
  ) {
    return this.submissions.submit(actor.id, dto.questionId, dto.license);
  }

  /** Chỉ liệt kê bản gửi thuộc trung tâm hiện hành. */
  @Get('mine')
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.submissions.listMine(actor.id);
  }

  /** Quản trị chọn câu từ các bank riêng thuộc trung tâm, kể cả câu của giáo viên. */
  @Get('sources')
  listSources(@CurrentUser() actor: AuthenticatedUser) {
    return this.submissions.listSources(actor.id);
  }

  /** Hàng chờ của biên tập viên hệ thống. */
  @Get('pending')
  listPending(@CurrentUser() actor: AuthenticatedUser) {
    return this.submissions.listPending(actor.id);
  }

  /** Biên tập viên đọc gói và dấu vết của một bản gửi để duyệt. */
  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.submissions.getForReview(actor.id, id);
  }

  /**
   * Ảnh riêng của bản gửi chỉ phục vụ người duyệt đã được xác thực.
   * Byte ảnh ở miền bank-system, không phụ thuộc quyền xem file gốc.
   */
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

  /** Duyệt vào bản công bố độc lập. */
  @Post(':id/approve')
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.submissions.approve(actor.id, id);
  }

  /** Từ chối kèm lý do bắt buộc, không ghi bản công bố. */
  @Post(':id/reject')
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: rejectSystemBankSubmissionSchema }) dto: RejectSystemBankSubmission,
  ) {
    return this.submissions.reject(actor.id, id, dto.reason);
  }
}
