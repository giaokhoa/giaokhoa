import { Module } from '@nestjs/common';
import { AssignmentsRepository } from '@giaokhoa/db/repositories/assignments';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrolModule } from '../enrol/enrol.module';
import { FilesModule } from '../files/files.module';
import { GradesModule } from '../grades/grades.module';
import { UsersModule } from '../users/users.module';
import { AssignCommentBankController, AssignmentsController, CourseAssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';

@Module({
  imports: [AccessModule, CoursesModule, EnrolModule, FilesModule, GradesModule, UsersModule, EventsModule, SpaceRoutingModule],
  controllers: [CourseAssignmentsController, AssignmentsController, AssignCommentBankController],
  providers: [
    {
      provide: AssignmentsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new AssignmentsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    AssignmentsService,
  ],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
