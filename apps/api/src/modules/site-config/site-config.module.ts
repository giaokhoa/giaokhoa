import { Module } from '@nestjs/common';
import { SiteConfigRepository } from '@giaokhoa/db/repositories/site-config';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';

@Module({
  imports: [AccessModule, TenantsModule, SpaceRoutingModule],
  controllers: [SiteConfigController],
  providers: [
    {
      provide: SiteConfigRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new SiteConfigRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    SiteConfigService,
  ],
  exports: [SiteConfigService],
})
export class SiteConfigModule {}
