import { forwardRef, Module } from '@nestjs/common';
import { UsersRepository } from '@giaokhoa/db/repositories/users';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { BetterAuthModule } from '../auth/better-auth/better-auth.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { PasswordService } from './password.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AccessModule, CustomFieldsModule, EventsModule, SpaceRoutingModule, forwardRef(() => BetterAuthModule), forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [
    {
      provide: UsersRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new UsersRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    UsersService, PasswordService,
  ],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
