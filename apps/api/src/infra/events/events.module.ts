import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { CentreDb } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { tenantAls } from '../../db/tenant-als';
import { EventLogWriter } from './event-log-writer.service';
import { OutboxService } from './outbox.service';

function spaceKyselyResolver(spaceDb: SpaceDatabaseService): () => Promise<CentreDb> {
  return async () => {
    const slug = tenantAls.getStore()?.spaceSlug;
    return slug ? spaceDb.getKyselyForSpace(slug) : spaceDb.routedKysely;
  };
}

@Module({
  imports: [EventEmitterModule.forRoot(), SpaceRoutingModule],
  providers: [
    {
      provide: OutboxService,
      useFactory: (spaceDb: SpaceDatabaseService) =>
        new OutboxService(spaceDb.routedKysely, spaceKyselyResolver(spaceDb)),
      inject: [SpaceDatabaseService],
    },
    {
      provide: EventLogWriter,
      useFactory: (spaceDb: SpaceDatabaseService) =>
        new EventLogWriter(spaceDb.routedKysely, spaceKyselyResolver(spaceDb)),
      inject: [SpaceDatabaseService],
    },
  ],
  exports: [OutboxService, EventLogWriter],
})
export class EventsModule {}
