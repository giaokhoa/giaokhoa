import { Module } from '@nestjs/common';
import { EnrolRepository } from '@giaokhoa/db/repositories/enrol';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { GroupsModule } from '../groups/groups.module';
import { MessagingModule } from '../messaging/messaging.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CourseEnrolmentsController, EnrolController } from './enrol.controller';
import { EnrolService } from './enrol.service';

@Module({
  imports: [AccessModule, CoursesModule, GroupsModule, EventsModule, MessagingModule, TenantsModule, SpaceRoutingModule],
  controllers: [EnrolController, CourseEnrolmentsController],
  providers: [
    {
      provide: EnrolRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new EnrolRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    EnrolService,
  ],
  exports: [EnrolService],
})
export class EnrolModule {}
