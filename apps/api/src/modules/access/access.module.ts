import { Module } from '@nestjs/common';
import { AccessRepository } from '@giaokhoa/db/repositories/access';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { CacheInfraModule } from '../../infra/cache/cache-infra.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessController } from './access.controller';
import { ContextsService } from './contexts.service';
import { PermissionEvaluator } from './permission-evaluator.service';
import { PlanLimitsService } from './plan-limits.service';
import { RoleSeparationService } from './role-separation.service';
import { RolesService } from './roles.service';

@Module({
  imports: [
    CacheInfraModule, EventsModule,
    SpaceRoutingModule,
  ],
  controllers: [AccessController],
  providers: [
    {
      provide: AccessRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new AccessRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    ContextsService, RolesService, PermissionEvaluator, PlanLimitsService, RoleSeparationService,
  ],
  exports: [ContextsService, RolesService, PermissionEvaluator, PlanLimitsService, RoleSeparationService],
})
export class AccessModule {}
