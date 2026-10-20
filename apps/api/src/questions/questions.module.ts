import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { QuestionsController } from './questions.controller.js';
import { StimuliController } from './stimuli.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [QuestionsController, StimuliController],
  providers: [
    {
      provide: PostgresQuestionsRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresQuestionsRepository(db),
    },
    {
      provide: QuestionsService,
      inject: [PostgresQuestionsRepository, AuthorizationService],
      useFactory: (repository: PostgresQuestionsRepository, authorization: AuthorizationService) =>
        new QuestionsService(repository, authorization),
    },
  ],
})
export class QuestionsModule {}
