import { Module } from '@nestjs/common';
import { EventsModule } from '../../infra/events/events.module';
import { AuthMailService } from './auth-mail.service';
import { ResendMailService } from './resend-mail.service';

@Module({
  imports: [EventsModule],
  providers: [ResendMailService, AuthMailService],
  exports: [ResendMailService, AuthMailService],
})
export class MailModule {}
