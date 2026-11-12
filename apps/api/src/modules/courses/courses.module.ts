import { Module } from '@nestjs/common';
import { CoursesRepository } from '@giaokhoa/db/repositories/courses';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { AvailabilityModule } from '../availability/availability.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

/** Facade của CoursesModule: CoursesService. Phụ thuộc Access, CustomFields, Availability (report §3.12). */
@Module({
  imports: [AccessModule, CustomFieldsModule, AvailabilityModule, EventsModule, TenantsModule, SpaceRoutingModule],
  controllers: [CoursesController],
  providers: [
    {
      // Dùng handle Kysely định tuyến theo không gian để toàn bộ truy vấn khoá học giữ đúng ngữ cảnh tenant/GUC/RLS.
      provide: CoursesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new CoursesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CoursesService,
  ],
  exports: [CoursesService],
})
/** Module khoá học. */
export class CoursesModule {}
