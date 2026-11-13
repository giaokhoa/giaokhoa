/** HTTP của luồng học liệu hệ thống; actor luôn lấy từ phiên, quyền do service kiểm trước khi đọc. */
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { rejectSystemBankSubmissionSchema, submitSystemMaterialSchema, useSystemMaterialSchema, uuidIdSchema, type UseSystemMaterial } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemMaterialsService } from './system-materials.service';

/** Phục vụ byte có xác thực, cấm cache/chạy nội dung tải lên như mã cùng origin. */
export function sendMaterialFile(res: Response, result: Awaited<ReturnType<SystemMaterialsService['readFile']>>) {
  res.attachment(result.file.fileName);
  res.setHeader('Content-Type', result.file.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.send(result.data);
}

@Controller({ path: 'system-bank/materials', version: '1' })
export class SystemMaterialsController {
  constructor(private readonly materials: SystemMaterialsService) {}

  /** Chọn từ nguồn học liệu trung tâm, không lấy category hoặc câu hỏi. */
  @Get('submissions/sources')
  sources(@CurrentUser() actor: AuthenticatedUser) { return this.materials.sources(actor.id); }

  /** Gửi bản chụp hiện tại vào hàng chờ. */
  @Post('submissions')
  submit(@CurrentUser() actor: AuthenticatedUser, @Body({ schema: submitSystemMaterialSchema }) dto: { contentId: string }) {
    return this.materials.submit(actor.id, dto.contentId);
  }

  /** Lịch sử của trung tâm đang đăng nhập. */
  @Get('submissions/mine')
  mine(@CurrentUser() actor: AuthenticatedUser) { return this.materials.mine(actor.id); }

  /** Hàng chờ biên tập hệ thống. */
  @Get('submissions/pending')
  pending(@CurrentUser() actor: AuthenticatedUser) { return this.materials.pending(actor.id); }

  /** ID bản gửi vẫn phải qua quyền hệ thống. */
  @Get('submissions/:id')
  submission(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.materials.forReview(actor.id, id);
  }

  /** Biên tập viên tải byte bản gửi độc lập để kiểm tra trước khi duyệt. */
  @Get('submissions/:id/media')
  async reviewMedia(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string, @Res() res: Response) {
    sendMaterialFile(res, await this.materials.preview(actor.id, id));
  }

  /** Duyệt phát hành phiên bản bất biến. */
  @Post('submissions/:id/approve')
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string) {
    return this.materials.review(actor.id, id);
  }

  /** Từ chối bắt buộc có lý do. */
  @Post('submissions/:id/reject')
  reject(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: rejectSystemBankSubmissionSchema }) dto: { reason: string }) {
    return this.materials.review(actor.id, id, dto.reason);
  }

  /** Giáo viên khám phá từng phiên bản đã công bố. */
  @Get()
  discover(@CurrentUser() actor: AuthenticatedUser) { return this.materials.discover(actor.id); }

  /** Dùng nguyên trạng trong khoá bằng pin, không tạo bản học liệu biên tập. */
  @Post('use')
  use(@CurrentUser() actor: AuthenticatedUser, @Body({ schema: useSystemMaterialSchema }) dto: UseSystemMaterial) {
    return this.materials.use(actor.id, dto);
  }

  /** Đọc trực tiếp version vẫn qua cổng giáo viên. */
  @Get(':id/versions/:version')
  version(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('version', { schema: z.coerce.number().int().positive() }) version: number) {
    return this.materials.versionForTeacher(actor.id, id, version);
  }

  /** Giáo viên xem tệp của phiên bản; học viên chỉ dùng URL của tài nguyên khoá. */
  @Get(':id/versions/:version/media')
  async media(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('version', { schema: z.coerce.number().int().positive() }) version: number, @Res() res: Response) {
    sendMaterialFile(res, await this.materials.preview(actor.id, id, version));
  }
}
