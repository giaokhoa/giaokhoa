import { Module } from '@nestjs/common';
import { EventLogRepository } from '@giaokhoa/db/repositories/event-log';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessModule } from '../access/access.module';
import { EventLogController } from './event-log.controller';
import { EventLogService } from './event-log.service';

@Module({
  imports: [AccessModule, SpaceRoutingModule],
  controllers: [EventLogController],
  providers: [
    {
      provide: EventLogRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new EventLogRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    EventLogService,
  ],
  exports: [EventLogService],
})
export class EventLogModule {}
