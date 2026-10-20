import { AttemptsService } from '@giaokhoa/application/attempts/service';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { PostgresAttemptsRepository } from '@giaokhoa/database/attempts';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AssignmentAttemptsController, AttemptsController } from './attempts.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [AssignmentAttemptsController, AttemptsController],
  providers: [
    {
      provide: PostgresAttemptsRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresAttemptsRepository(db),
    },
    {
      provide: AttemptsService,
      inject: [PostgresAttemptsRepository, AuthorizationService],
      useFactory: (repository: PostgresAttemptsRepository, authorization: AuthorizationService) =>
        new AttemptsService(repository, authorization),
    },
  ],
})
export class AttemptsModule {}
