import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CompletionRepository } from '@giaokhoa/db/repositories/completion';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { AvailabilityModule } from '../availability/availability.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrolModule } from '../enrol/enrol.module';
import { CompletionController, CourseModuleCompletionController } from './completion.controller';
import { CompletionReaggregationOutboxConsumer } from './completion-reaggregation-outbox.consumer';
import { COMPLETION_QUEUE, CompletionService } from './completion.service';

@Module({
  imports: [
    AccessModule, CoursesModule, EnrolModule, AvailabilityModule, EventsModule, SpaceRoutingModule,
    BullModule.registerQueue({ name: COMPLETION_QUEUE }),
  ],
  controllers: [CompletionController, CourseModuleCompletionController],
  providers: [
    {
      provide: CompletionRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new CompletionRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CompletionService,
    CompletionReaggregationOutboxConsumer,
  ],
  exports: [CompletionService],
})
export class CompletionModule {}
