import { CurriculumService } from '@giaokhoa/application/curriculum/service';
import { PostgresCurriculumRepository } from '@giaokhoa/database/curriculum';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import {
  CurriculaController,
  CurriculumNodesController,
  LearningOutcomesController,
  SubjectsController,
} from './curriculum.controller.js';

@Module({
  controllers: [
    SubjectsController,
    CurriculaController,
    CurriculumNodesController,
    LearningOutcomesController,
  ],
  providers: [
    {
      provide: PostgresCurriculumRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresCurriculumRepository(db),
    },
    {
      provide: CurriculumService,
      inject: [PostgresCurriculumRepository],
      useFactory: (repository: PostgresCurriculumRepository) => new CurriculumService(repository),
    },
  ],
})
export class CurriculumModule {}
