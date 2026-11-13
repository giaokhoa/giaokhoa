import { Module } from '@nestjs/common';
import { ClassesRepository } from '@giaokhoa/db/repositories/classes';
import { GroupsRepository } from '@giaokhoa/db/repositories/groups';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { ControlPlaneModule } from '../control-plane/control-plane.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrolModule } from '../enrol/enrol.module';
import { GroupsModule } from '../groups/groups.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';

@Module({
  imports: [AccessModule, CoursesModule, GroupsModule, EnrolModule, TenantsModule, UsersModule, EventsModule, SpaceRoutingModule, ControlPlaneModule],
  controllers: [ClassesController],
  providers: [
    {
      provide: ClassesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new ClassesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: GroupsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new GroupsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    ClassesService,
  ],
  exports: [ClassesService, ClassesRepository],
})
export class ClassesModule {}
