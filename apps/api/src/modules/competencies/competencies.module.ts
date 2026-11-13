import { Module } from '@nestjs/common';
import { CompetenciesRepository } from '@giaokhoa/db/repositories/competencies';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CompletionModule } from '../completion/completion.module';
import { CoursesModule } from '../courses/courses.module';
import { GroupsModule } from '../groups/groups.module';
import { MessagingModule } from '../messaging/messaging.module';
import { UsersModule } from '../users/users.module';
import { CompetenciesController } from './competencies.controller';
import { CompetenciesService } from './competencies.service';

@Module({
  imports: [AccessModule, CoursesModule, GroupsModule, CompletionModule, MessagingModule, UsersModule, EventsModule, SpaceRoutingModule],
  controllers: [CompetenciesController],
  providers: [
    {
      provide: CompetenciesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new CompetenciesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CompetenciesService,
  ],
  exports: [CompetenciesService],
})
export class CompetenciesModule {}
