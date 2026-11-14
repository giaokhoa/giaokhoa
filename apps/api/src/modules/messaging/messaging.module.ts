import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { SiteConfigModule } from '../site-config/site-config.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { BetterAuthModule } from '../auth/better-auth/better-auth.module';
import { MessagingController, NotificationsController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';

import { MessagingRealtimeService } from './messaging-realtime.service';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';
import { createMessagingStore } from '@giaokhoa/messaging';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { MessagingSendThrottleService } from './messaging-send-throttle.service';
import { MessagingService, NOTIFICATION_DISPATCH_QUEUE } from './messaging.service';
import { MessagingSocketAuth } from './messaging-socket-auth';
import { NotificationUnreadStreamService } from './notification-unread-stream.service';

@Module({
  imports: [
    AccessModule, UsersModule, EventsModule, SiteConfigModule,
    BetterAuthModule,
    SpaceRoutingModule, TenantsModule,
    BullModule.registerQueue({ name: NOTIFICATION_DISPATCH_QUEUE }),
  ],
  controllers: [MessagingController, NotificationsController],
  providers: [
    {
      provide: MessagingRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new MessagingRepository(
        spaceDb.routedKysely,
        createMessagingStore(spaceDb.routedKysely),
      ),
      inject: [SpaceDatabaseService],
    },
    MessagingService, NotificationUnreadStreamService,
    MessagingSendThrottleService,

    MessagingSocketAuth, MessagingRealtimeService, MessagingGateway,
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
