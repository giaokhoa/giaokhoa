import { Body, Controller, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { Public } from '../../common/public.decorator';
import { PublicRegistrationService } from './public-registration.service';

export const publicRegistrationSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  email: z.email(),
  password: z.string().min(8),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(['student', 'teacher']),
});

@Controller({ path: 'auth/public', version: '1' })
export class PublicRegistrationController {
  constructor(private readonly registrations: PublicRegistrationService) {}

  @Public()
  @Post('register')
  async register(
    @Body({ schema: publicRegistrationSchema }) data: z.infer<typeof publicRegistrationSchema>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.registrations.register(req.headers.host, data);
  }
}
