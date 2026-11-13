import { Module } from '@nestjs/common';
import { GroupsRepository } from '@giaokhoa/db/repositories/groups';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { AvailabilityModule } from '../availability/availability.module';
import { CoursesModule } from '../courses/courses.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CohortsController, CourseGroupingsController, CourseGroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [AccessModule, CoursesModule, AvailabilityModule, EventsModule, TenantsModule, SpaceRoutingModule],
  controllers: [CourseGroupsController, CourseGroupingsController, CohortsController],
  providers: [
    {
      provide: GroupsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new GroupsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    GroupsService,
  ],
  exports: [GroupsService],
})
export class GroupsModule {}
