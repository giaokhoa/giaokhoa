import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { createCentreKysely } from '@giaokhoa/db';
import { I18nWorkerModule } from './i18n/i18n.config';
import { databaseConnectionFromEnv, redisConnectionFromUrl, validateEnv } from './config/env';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { SpaceRoutingModule } from './db/routing/space-routing.module';
import { TenantAwarePool } from './db/tenant-pool';
import { EnrolExpiryScheduler } from './enrol-expiry.scheduler';
import { ClassEnrolReconcileScheduler } from './class-enrol-reconcile.scheduler';
import { ClassEnrolReconcileProcessor } from './processors/class-enrol-reconcile.processor';
import { ActivityDueReminderScheduler } from './activity-due-reminder.scheduler';
import { NotificationRetentionScheduler } from './notification-retention.scheduler';
import { NotificationDeliveryService } from './notification-delivery.service';
import { GuardianDigestScheduler } from './guardian-digest.scheduler';
import { GuardianDigestProcessor } from './processors/guardian-digest.processor';
import { GuardianDigestEventsProcessor } from './processors/guardian-digest-events.processor';
import { GuardianDigestHandlerService } from './guardian-digest-handler.service';
import { NotificationEventsProcessor } from './processors/notification-events.processor';
import { NotificationEventsHandlerService } from './notification-events-handler.service';
import { NotificationEventsMarker } from './notification-events-marker.service';
import { NotificationEventsCatchupService } from './notification-events-catchup.service';
import { MessagingRealtimeProcessor, MESSAGING_DISTRIBUTED_REDIS, MESSAGING_DISTRIBUTION_SERVICE } from './processors/messaging-realtime.processor';
import { MessagingRealtimeRuntime } from './messaging-realtime.runtime';
import { CohortSyncService } from './cohort-sync.service';
import { CohortSyncEventsProcessor } from './processors/cohort-sync-events.processor';
import { CohortSyncCatchupService } from './cohort-sync-catchup.service';
import { EventLogWriter } from './event-log-writer.service';
import { OutboxRelayScheduler } from './outbox-relay.scheduler';
import {
  OUTBOX_EVENT_QUEUE_ROUTES,
  OUTBOX_EVENT_QUEUES,
  OUTBOX_EVENT_ROUTES,
  allQueueNamesOfRoutes,
  type OutboxEventQueues,
} from './outbox-event-routes';
import { TaskLogService } from './task-log.service';
import { BadgeAwardProcessor } from './processors/badge-award.processor';
import { CalendarImportProcessor } from './processors/calendar-import.processor';
import { CalendarReminderProcessor } from './processors/calendar-reminder.processor';
import { CompletionRecalculateProcessor } from './processors/completion-recalculate.processor';
import { NotificationDispatchProcessor } from './processors/notification-dispatch.processor';
import { NotificationDigestProcessor } from './processors/notification-digest.processor';
import { NotificationDigestScheduler } from './notification-digest.scheduler';
import { ResendMailService } from './resend-mail.service';
import { NotificationRetentionProcessor } from './processors/notification-retention.processor';
import { EnrolExpiryProcessor } from './processors/enrol-expiry.processor';
import { ActivityDueReminderProcessor } from './processors/activity-due-reminder.processor';
import { FileCleanupProcessor } from './processors/file-cleanup.processor';
import {
  AUTH_MAIL_SENT_MARKER, AuthMailProcessor, RedisAuthMailSentMarker,
} from './processors/auth-mail.processor';
import {
  OutboxWriterService,
  PAID_CLASS_ENROL_ACTIVATION_PORT,
  PAID_ENROL_ACTIVATION_PORT,
  PAYMENT_SETTLEMENT_PORT,
  PaymentsRepository,
  PlanEntitlementsService,
  SepayMatchingService,
} from '@giaokhoa/payments';
import { SepayMatchingScheduler } from './sepay-matching.scheduler';
import { WorkerEnrolOutboxService } from './worker-enrol-outbox.service';
import { WorkerPaidClassEnrolActivationService } from './worker-paid-class-enrol-activation.service';
import { WorkerPaidEnrolActivationService } from './worker-paid-enrol-activation.service';
import { WorkerPaymentSettlementService } from './worker-payment-settlement.service';
import { WorkerPaymentSpaceScope } from './worker-payment-space-scope.service';
import {
  AnalyticsRunProcessor, BackupProcessor, PaymentReconciliationProcessor, PrivacyProcessor,
  ReportScheduleProcessor, RestoreProcessor, SearchReindexProcessor,
} from './processors/platform-services.processors';

const outboxRouteQueueNames: string[] = allQueueNamesOfRoutes(OUTBOX_EVENT_QUEUE_ROUTES);

const SHARED_CENTRE_KYSELY = 'SHARED_CENTRE_KYSELY';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    I18nWorkerModule,
    SpaceRoutingModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionFromUrl(config.getOrThrow<string>('REDIS_URL')),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      }),
    }),
    BullModule.registerQueue({ name: 'file-cleanup' }),
    BullModule.registerQueue({ name: 'enrol-expiry' }),
    BullModule.registerQueue({ name: 'class-enrol-reconcile' }),
    BullModule.registerQueue({ name: 'activity-due-reminders' }),
    BullModule.registerQueue({ name: 'guardian-digests' }),
    BullModule.registerQueue({ name: 'completion-recalculate' }),
    BullModule.registerQueue({ name: 'notification-dispatch' }),
    BullModule.registerQueue({ name: 'notification-digests' }),
    BullModule.registerQueue({ name: 'notification-retention' }),
    BullModule.registerQueue({ name: 'calendar-reminders' }),
    BullModule.registerQueue({ name: 'calendar-import' }),
    BullModule.registerQueue({ name: 'badge-award' }),
    BullModule.registerQueue({ name: 'backup' }),
    BullModule.registerQueue({ name: 'restore' }),
    BullModule.registerQueue({ name: 'search-reindex' }),
    BullModule.registerQueue({ name: 'analytics-run' }),
    BullModule.registerQueue({ name: 'report-schedule' }),
    BullModule.registerQueue({ name: 'privacy' }),
    BullModule.registerQueue({ name: 'payment-reconciliation' }),
    ...outboxRouteQueueNames.map((name) => BullModule.registerQueue({ name })),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
  ],
  providers: [
    {
      provide: SHARED_CENTRE_KYSELY,
      inject: [ConfigService, SpaceDatabaseService],
      useFactory: (config: ConfigService, spaceDatabase: SpaceDatabaseService) => {
        const connection = databaseConnectionFromEnv(
          config.getOrThrow<string>('DATABASE_URL'),
          config.get<boolean>('DATABASE_SSL') ?? false,
        );
        const poolConfig = typeof connection === 'string' ? { connectionString: connection } : connection;
        const poolMax = config.get<number>('DATABASE_POOL_MAX');
        const pool = new TenantAwarePool(poolMax ? { ...poolConfig, max: poolMax } : poolConfig);
        spaceDatabase.bindSharedKysely(createCentreKysely(pool));
        return pool;
      },
    },
    { provide: OUTBOX_EVENT_ROUTES, useValue: OUTBOX_EVENT_QUEUE_ROUTES },
    {
      provide: OUTBOX_EVENT_QUEUES,
      inject: outboxRouteQueueNames.map((name) => getQueueToken(name)),
      useFactory: (...queues: Queue[]): OutboxEventQueues =>
        new Map(outboxRouteQueueNames.map((name, index) => [name, queues[index]!] as const)),
    },
    FileCleanupProcessor, OutboxRelayScheduler, EventLogWriter, TaskLogService, EnrolExpiryProcessor, ClassEnrolReconcileProcessor, ClassEnrolReconcileScheduler, ActivityDueReminderProcessor, ActivityDueReminderScheduler, GuardianDigestProcessor, GuardianDigestScheduler, GuardianDigestEventsProcessor, GuardianDigestHandlerService, CompletionRecalculateProcessor, EnrolExpiryScheduler, NotificationDispatchProcessor, ResendMailService, NotificationDigestProcessor, NotificationDigestScheduler, NotificationDeliveryService, NotificationRetentionProcessor, NotificationRetentionScheduler, CalendarReminderProcessor, CalendarImportProcessor, BadgeAwardProcessor, BackupProcessor, RestoreProcessor, SearchReindexProcessor, AnalyticsRunProcessor, ReportScheduleProcessor, PrivacyProcessor, PaymentReconciliationProcessor,
    MessagingRealtimeRuntime,
    {
      provide: MESSAGING_DISTRIBUTION_SERVICE,
      inject: [MessagingRealtimeRuntime],
      useFactory: (runtime: MessagingRealtimeRuntime) => runtime.distribution,
    },
    {
      provide: MESSAGING_DISTRIBUTED_REDIS,
      inject: [MessagingRealtimeRuntime],
      useFactory: (runtime: MessagingRealtimeRuntime) => runtime.redis,
    },
    MessagingRealtimeProcessor,
    AuthMailProcessor, { provide: AUTH_MAIL_SENT_MARKER, useClass: RedisAuthMailSentMarker },
    NotificationEventsProcessor, NotificationEventsHandlerService, NotificationEventsMarker, NotificationEventsCatchupService,
    CohortSyncService, CohortSyncEventsProcessor, CohortSyncCatchupService,
    {
      provide: PaymentsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new PaymentsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: OutboxWriterService,
      useFactory: (spaceDb: SpaceDatabaseService) => new OutboxWriterService(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    PlanEntitlementsService, SepayMatchingService,
    WorkerEnrolOutboxService, WorkerPaymentSpaceScope, WorkerPaidEnrolActivationService, WorkerPaidClassEnrolActivationService, WorkerPaymentSettlementService,
    { provide: PAID_ENROL_ACTIVATION_PORT, useExisting: WorkerPaidEnrolActivationService },
    { provide: PAID_CLASS_ENROL_ACTIVATION_PORT, useExisting: WorkerPaidClassEnrolActivationService },
    { provide: PAYMENT_SETTLEMENT_PORT, useExisting: WorkerPaymentSettlementService },
    SepayMatchingScheduler],})
export class WorkerModule {}
