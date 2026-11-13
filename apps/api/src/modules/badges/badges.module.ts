import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BadgesRepository } from '@giaokhoa/db/repositories/badges';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CompetenciesModule } from '../competencies/competencies.module';
import { CompletionModule } from '../completion/completion.module';
import { CoursesModule } from '../courses/courses.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { GroupsModule } from '../groups/groups.module';
import { MessagingModule } from '../messaging/messaging.module';
import { UsersModule } from '../users/users.module';
import { BadgesController } from './badges.controller';
import { BADGE_AWARD_QUEUE, BadgesService } from './badges.service';

@Module({
  imports: [
    AccessModule, CoursesModule, CompletionModule, CompetenciesModule, MessagingModule, UsersModule, GroupsModule, CustomFieldsModule, EventsModule, SpaceRoutingModule,
    BullModule.registerQueue({ name: BADGE_AWARD_QUEUE }),
  ],
  controllers: [BadgesController],
  providers: [
    {
      provide: BadgesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new BadgesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    BadgesService,
  ],
  exports: [BadgesService],
})
export class BadgesModule {}
