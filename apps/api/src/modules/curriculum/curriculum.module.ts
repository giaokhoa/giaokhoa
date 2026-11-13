import { Module } from '@nestjs/common';
import { CurriculumRepository } from '@giaokhoa/db/repositories/curriculum';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';
import { ProgramDumpService } from './program-dump.service';
import { ProgramImportService } from './program-import.service';

@Module({
  imports: [AccessModule, CoursesModule, SpaceRoutingModule],
  controllers: [CurriculumController],
  providers: [
    {
      provide: CurriculumRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new CurriculumRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CurriculumService, ProgramImportService, ProgramDumpService,
  ],
  exports: [CurriculumService, CurriculumRepository, ProgramImportService, ProgramDumpService],
})
export class CurriculumModule {}
