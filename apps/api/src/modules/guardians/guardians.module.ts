import { Module } from '@nestjs/common';
import { GuardianViewRepository } from '@giaokhoa/db/repositories/guardian-view';
import { GuardiansRepository } from '@giaokhoa/db/repositories/guardians';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { GradesModule } from '../grades/grades.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { GuardianController, GuardianLinksController } from './guardians.controller';
import { GuardianDigestService } from './guardian-digest.service';
import { GuardianViewService } from './guardian-view.service';
import { GuardiansService } from './guardians.service';

@Module({
  imports: [AccessModule, UsersModule, GradesModule, EventsModule, DashboardModule, TenantsModule, SpaceRoutingModule],
  controllers: [GuardianLinksController, GuardianController],
  providers: [
    {
      provide: GuardiansRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new GuardiansRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    GuardiansService,
    {
      provide: GuardianViewRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new GuardianViewRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    GuardianViewService,
    GuardianDigestService,
  ],
  exports: [GuardiansService],
})
export class GuardiansModule {}
