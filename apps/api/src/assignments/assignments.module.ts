import { AssignmentsService } from '@giaokhoa/application/assignments/service';
import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { PostgresAssignmentsRepository } from '@giaokhoa/database/assignments';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AssignmentsController } from './assignments.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [AssignmentsController],
  providers: [
    {
      provide: PostgresAssignmentsRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresAssignmentsRepository(db),
    },
    {
      provide: AssignmentsService,
      inject: [PostgresAssignmentsRepository, AuthorizationService],
      useFactory: (
        repository: PostgresAssignmentsRepository,
        authorization: AuthorizationService,
      ) => new AssignmentsService(repository, authorization),
    },
  ],
})
export class AssignmentsModule {}
