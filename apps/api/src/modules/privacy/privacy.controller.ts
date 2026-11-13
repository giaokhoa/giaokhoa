import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { createPrivacyRequestServerSchema, decidePrivacyRequestSchema, type CreatePrivacyRequestDto, type DecidePrivacyRequestDto } from './dto/privacy.dto';
import { PrivacyService } from './privacy.service';

/** Controller Privacy: providers registry, requests, phê duyệt, export files. */
@ApiTags('privacy')
@Controller({ path: 'privacy', version: '1' })
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get('providers')
  /**
   * GET /privacy/providers — danh sách provider đã đăng ký kèm metadata dữ liệu cá nhân của từng subsystem.
   */
  async providers() { return this.privacy.listProviders(); }
  @Get('completeness')
  /**
   * GET /privacy/completeness — subsystem nghiệp vụ kỳ vọng nào chưa có provider (delete thiếu provider là FAIL).
   */
  async completeness() {
    const missing = this.privacy.missingProviders();
    return { missing, complete: missing.length === 0 };
  }
  @Post('requests')
  /**
   * POST /privacy/requests — gửi yêu cầu export/delete cho chính mình; gửi hộ cần capability privacy:manage.
   */
  async create(@Body({ schema: createPrivacyRequestServerSchema }) dto: CreatePrivacyRequestDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.privacy.createRequest(actor.id, dto);
  }
  @Get('requests')
  /**
   * GET /privacy/requests — yêu cầu của chính mình; admin có privacy:manage thấy toàn bộ.
   */
  async list(@CurrentUser() actor: AuthenticatedUser) { return this.privacy.listRequestsFor(actor.id); }
  @Get('requests/:id')
  /**
   * GET /privacy/requests/:id — đọc một yêu cầu (chỉ chủ thể, người gửi hộ, hoặc admin privacy:manage; người ngoài nhận 404).
   */
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { return this.privacy.getRequestFor(actor.id, id); }
  @Get('requests/:id/files')
  /**
   * GET /privacy/requests/:id/files — file xuất của một yêu cầu (qua cùng cổng sở hữu như đọc yêu cầu).
   */
  async files(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { return this.privacy.listExportFilesFor(actor.id, id); }
  @Post('requests/:id/decide')
  /**
   * POST /privacy/requests/:id/decide — phê duyệt/từ chối yêu cầu (privacy:manage); duyệt thì xử lý ngay.
   */
  async decide(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: decidePrivacyRequestSchema }) dto: DecidePrivacyRequestDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.privacy.decide(actor.id, id, dto.decision);
  }
  @Post('requests/:id/process')
  /**
   * POST /privacy/requests/:id/process — xử lý một yêu cầu đã duyệt (export gói JSON hoặc xoá đủ mọi subsystem).
   */
  async process(@Param('id', { schema: uuidIdSchema }) id: string) { return this.privacy.processRequest(id); }
}
