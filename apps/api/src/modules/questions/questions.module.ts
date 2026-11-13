import { Module } from '@nestjs/common';
import { QuestionBanksRepository } from '@giaokhoa/db/repositories/question-banks';
import { QuestionsRepository } from '@giaokhoa/db/repositories/questions';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { FilesModule } from '../files/files.module';
import { GroupsModule } from '../groups/groups.module';
import { TenantsModule } from '../tenants/tenants.module';
import { QuestionBanksService } from './question-banks.service';
import { QuestionsController, QuestionUsagesController, StimuliController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({
  imports: [AccessModule, EventsModule, GroupsModule, TenantsModule, FilesModule, SpaceRoutingModule],
  controllers: [QuestionsController, QuestionUsagesController, StimuliController],
  providers: [
    {
      provide: QuestionsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new QuestionsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: QuestionBanksRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new QuestionBanksRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    QuestionsService, QuestionBanksService,
  ],
  exports: [QuestionsService, QuestionBanksService],
})
export class QuestionsModule {}
