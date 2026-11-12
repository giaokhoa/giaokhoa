import { Module } from '@nestjs/common';
import { SiteConfigRepository } from '@giaokhoa/db/repositories/site-config';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';

@Module({
  // SpaceRoutingModule cấp handle `routedKysely` cho SiteConfigRepository qua factory, để cấu hình đọc/ghi đúng kho của request.
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
/** Module cấu hình site và cấu hình theo plugin (admin settings). */
export class SiteConfigModule {}
