import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/public.decorator';
import { PublicRegistrationService } from './public-registration.service';
import { publicRegistrationSchema, type PublicRegistrationDto } from './dto/public-registration.dto';

/**
 * Giao diện đăng ký của khu công cộng; không dùng sign-up toàn cục
 * của Better Auth vì địa chỉ trung tâm và kho vận hành không được
 * phép tự tạo tài khoản. Handler chỉ chạy sau guard gắn kho đích.
 */

@Controller({ path: 'auth/public', version: '1' })
export class PublicRegistrationController {
  constructor(private readonly registrations: PublicRegistrationService) {}

  @Public()
  @Post('register')
  async register(
    @Body({ schema: publicRegistrationSchema }) data: PublicRegistrationDto,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.registrations.register(req.headers.host, data);
  }
}
