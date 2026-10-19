import { QuestionsService } from '@giaokhoa/application/questions/service';
import { PostgresQuestionsRepository } from '@giaokhoa/database/questions';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { QuestionsController } from './questions.controller.js';
import { StimuliController } from './stimuli.controller.js';

@Module({
  controllers: [QuestionsController, StimuliController],
  providers: [
    {
      provide: PostgresQuestionsRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresQuestionsRepository(db),
    },
    {
      provide: QuestionsService,
      inject: [PostgresQuestionsRepository],
      useFactory: (repository: PostgresQuestionsRepository) => new QuestionsService(repository),
    },
  ],
})
export class QuestionsModule {}
