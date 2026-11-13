import { Module } from '@nestjs/common';
import { AnalyticsRepository } from '@giaokhoa/db/repositories/analytics';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrolModule } from '../enrol/enrol.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [AccessModule, CoursesModule, EnrolModule, SpaceRoutingModule],
  controllers: [AnalyticsController],
  providers: [
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
