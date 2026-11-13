import { BullModule } from '@nestjs/bullmq';
import { Module, type ExecutionContext, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createCentreKysely } from '@giaokhoa/db';
import { databaseConnectionFromEnv, redisConnectionFromUrl, validateEnv } from './config/env';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { SpaceRoutingModule } from './db/routing/space-routing.module';
import { TenantAwarePool } from './db/tenant-pool';
import { CacheInfraModule } from './infra/cache/cache-infra.module';
import { EventsModule } from './infra/events/events.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BadgesModule } from './modules/badges/badges.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CompetenciesModule } from './modules/competencies/competencies.module';
import { CompletionModule } from './modules/completion/completion.module';
import { CoursesModule } from './modules/courses/courses.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { EnrolModule } from './modules/enrol/enrol.module';
import { GradesModule } from './modules/grades/grades.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { GroupsModule } from './modules/groups/groups.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { AssessmentRoutesModule } from './modules/assessment-routes/assessment-routes.module';
import { McpModule } from './modules/mcp/mcp.module';
import { ExamsModule } from './modules/exams/exams.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { PaperGradingModule } from './modules/paper-grading/paper-grading.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { ContentModule } from './modules/content/content.module';
import { CurriculumModule } from './modules/curriculum/curriculum.module';
import { BooksModule } from './modules/books/books.module';
import { SocialModule } from './modules/social/social.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { SeedModule } from './modules/seed/seed.module';
import { UsersModule } from './modules/users/users.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BackupModule } from './modules/backup/backup.module';
import { ContentBankModule } from './modules/content-bank/content-bank.module';
import { ControlPlaneModule } from './modules/control-plane/control-plane.module';
import { SupportModule } from './modules/support/support.module';
import { SystemBankModule } from './modules/system-bank/system-bank.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EventLogModule } from './modules/event-log/event-log.module';
import { SearchModule } from './modules/search/search.module';
import { SiteConfigModule } from './modules/site-config/site-config.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ClassesModule } from './modules/classes/classes.module';
import { SpaceContextGuard } from './modules/tenants/space-context.guard';
import { TenantGuard } from './modules/tenants/tenant.guard';
import { TenantContextInterceptor } from './modules/tenants/tenant-context.interceptor';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { I18nStandardSchemaValidationPipe } from '@nestjs/i18n';
import { I18nFoundationModule } from './i18n/i18n.config';
import { AudienceGuard } from './common/audience.guard';
import { BetterAuthSessionGuard } from './common/better-auth-session.guard';
import { CapabilityGuard } from './common/capability.guard';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { BetterAuthModule } from './modules/auth/better-auth/better-auth.module';
import { SecurityHeadersMiddleware } from './common/security-headers.middleware';

const CREDENTIAL_ROUTES = /^\/api\/v\d+\/auth\/(token|login|session\/login|change-password|platform\/login|support\/login)$/;
const REGISTRATION_ROUTES = /^\/api\/v\d+\/auth\/public\/register$/;

const SHARED_CENTRE_KYSELY = 'SHARED_CENTRE_KYSELY';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    I18nFoundationModule,
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
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.get<number>('RATE_LIMIT_PER_MINUTE') ?? 3000 },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.get<number>('RATE_LIMIT_AUTH_PER_MINUTE') ?? 300,
            skipIf: (context: ExecutionContext) => {
              const req = context.switchToHttp().getRequest<{ method?: string; path?: string; url?: string }>();
              const path = req.path ?? req.url ?? '';
              return !(req.method === 'POST' && CREDENTIAL_ROUTES.test(path));
            },
          },
          {
            name: 'registration',
            ttl: 60_000,
            limit: config.get<number>('RATE_LIMIT_REGISTRATION_PER_MINUTE') ?? 5,
            skipIf: (context: ExecutionContext) => {
              const req = context.switchToHttp().getRequest<{ method?: string; path?: string; url?: string }>();
              return !(req.method === 'POST' && REGISTRATION_ROUTES.test(req.path ?? req.url ?? ''));
            },
          },
        ],
      }),
    }),
    CacheInfraModule,
    EventsModule,
    HealthModule,
    AccessModule,
    CustomFieldsModule,
    UsersModule,
    AuthModule,
    BetterAuthModule,
    FilesModule,
    AvailabilityModule,
    CoursesModule,
    GroupsModule,
    EnrolModule,
    CompletionModule,
    GradesModule,
    GuardiansModule,
    DashboardModule,
    QuestionsModule,
    McpModule,
    ExamsModule,
    QuizModule,
    AssessmentRoutesModule,
    PaperGradingModule,
    AssignmentsModule,
    ContentModule,
    CurriculumModule,
    BooksModule,
    MessagingModule,
    CalendarModule,
    CompetenciesModule,
    BadgesModule,
    SocialModule,
    SearchModule,
    IntegrationsModule,
    PaymentsModule,
    BackupModule,
    AnalyticsModule,
    ReportsModule,
    EventLogModule,
    ContentBankModule,
    ControlPlaneModule,
    SupportModule,
    SystemBankModule,
    SpaceRoutingModule,
    PrivacyModule,
    SiteConfigModule,
    TenantsModule,
    ClassesModule,
    SeedModule,
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthSessionGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AudienceGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: SpaceContextGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_PIPE, useValue: new I18nStandardSchemaValidationPipe() },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
