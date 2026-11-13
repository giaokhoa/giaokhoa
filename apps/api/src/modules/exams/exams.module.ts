import { Module } from '@nestjs/common';
import { ExamsRepository } from '@giaokhoa/db/repositories/exams';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { QuestionsModule } from '../questions/questions.module';
import { QuizModule } from '../quiz/quiz.module';
import { SiteConfigModule } from '../site-config/site-config.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ExamDossiersService } from './exam-dossiers.service';
import { ExamsController } from './exams.controller';
import { ExamPapersAliasController } from './exam-papers-alias.controller';
import { CourseExamPinsController, ExamPinFeedbacksController, ExamPinOverridesController, ExamPinsController } from './exam-pins.controller';
import { ExamsService } from './exams.service';

@Module({
  imports: [AccessModule, EventsModule, QuestionsModule, QuizModule, SiteConfigModule, TenantsModule, SpaceRoutingModule],
  controllers: [ExamsController, ExamPapersAliasController, CourseExamPinsController, ExamPinsController, ExamPinOverridesController, ExamPinFeedbacksController],
  providers: [
    { provide: ExamsRepository, useFactory: (spaceDb: SpaceDatabaseService) => new ExamsRepository(spaceDb.routedKysely), inject: [SpaceDatabaseService] },
    ExamsService, ExamDossiersService,
  ],
  exports: [ExamsService],
})
export class ExamsModule {}
