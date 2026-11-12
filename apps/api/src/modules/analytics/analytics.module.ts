import { Module } from '@nestjs/common';
import { AnalyticsRepository } from '@giaokhoa/db/repositories/analytics';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrolModule } from '../enrol/enrol.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** Lắp AnalyticsService và repository từ handle định tuyến để truy vấn phân tích đúng kho của tenant. */
@Module({
  imports: [AccessModule, CoursesModule, EnrolModule, SpaceRoutingModule],
  controllers: [AnalyticsController],
  providers: [
    // Dùng handle Kysely định tuyến của SpaceDatabaseService thay vì một kết nối kho cố định.
    {
      provide: AnalyticsRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new AnalyticsRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    AnalyticsService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
