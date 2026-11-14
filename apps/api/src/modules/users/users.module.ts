import { Module } from '@nestjs/common';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { BetterAuthModule } from '../auth/better-auth/better-auth.module';
import { AuthSharedModule } from '../auth-shared/auth-shared.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AccessModule, CustomFieldsModule, EventsModule, BetterAuthModule, AuthSharedModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, AuthSharedModule],
})
export class UsersModule {}
