import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ExamsService } from '@giaokhoa/application/exams/service';
import { PostgresExamsRepository } from '@giaokhoa/database/exams';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ExamsController } from './exams.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [ExamsController],
  providers: [
    {
      provide: PostgresExamsRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresExamsRepository(db),
    },
    {
      provide: ExamsService,
      inject: [PostgresExamsRepository, AuthorizationService],
      useFactory: (repository: PostgresExamsRepository, authorization: AuthorizationService) =>
        new ExamsService(repository, authorization),
    },
  ],
})
export class ExamsModule {}
