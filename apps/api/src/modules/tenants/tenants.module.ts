import { Module } from '@nestjs/common';
import { CentreIdentityRepository } from '@giaokhoa/db/repositories/centre-identity';
import { SiteConfigRepository } from '@giaokhoa/db/repositories/site-config';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { ControlPlaneModule } from '../control-plane/control-plane.module';
import { UsersModule } from '../users/users.module';
import { CentreIdentityController } from './centre-identity.controller';
import { CentreIdentityService } from './centre-identity.service';
import { SpaceContextGuard } from './space-context.guard';
import { SpaceProgramPackageService } from './space-program-package.service';
import { TenantConfigService } from './tenant-config.service';
import { TenantContextService } from './tenant-context.service';
import { TenantDbService } from './tenant-db.service';
import { TenantGuard } from './tenant.guard';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AccessModule, UsersModule, EventsModule, SpaceRoutingModule, ControlPlaneModule],
  controllers: [TenantsController, CentreIdentityController],
  providers: [
    {
      provide: TenantsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new TenantsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: CentreIdentityRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new CentreIdentityRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: SiteConfigRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new SiteConfigRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CentreIdentityService,
    TenantsService,
    TenantConfigService,
    TenantContextService,
    TenantDbService,
    TenantGuard,
    SpaceContextGuard,
    SpaceProgramPackageService,
  ],
  exports: [
    TenantsRepository,
    SiteConfigRepository,
    TenantsService,
    TenantConfigService,
    TenantContextService,
    TenantDbService,
    TenantGuard,
    SpaceContextGuard,
    SpaceProgramPackageService,
  ],
})
export class TenantsModule {}
