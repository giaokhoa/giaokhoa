import { Module } from '@nestjs/common';
import { PaperGradingRepository } from '@giaokhoa/db/repositories/paper-grading';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { EnrolModule } from '../enrol/enrol.module';
import { FilesModule } from '../files/files.module';
import { QuizModule } from '../quiz/quiz.module';
import { SiteConfigModule } from '../site-config/site-config.module';
import { UsersModule } from '../users/users.module';
import { ExamBatchesController, ExamScansController } from './paper-grading.controller';
import { PaperGradingService } from './paper-grading.service';

@Module({
  imports: [AccessModule, QuizModule, EnrolModule, UsersModule, FilesModule, SiteConfigModule, EventsModule, SpaceRoutingModule],
  controllers: [ExamBatchesController, ExamScansController],
  providers: [
    {
      provide: PaperGradingRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new PaperGradingRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    PaperGradingService,
  ],
  exports: [PaperGradingService],
})
export class PaperGradingModule {}
