import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';

@Module({
  imports: [AccessModule, TenantsModule],
  controllers: [SiteConfigController],
  providers: [SiteConfigService],
  exports: [SiteConfigService],
})
export class SiteConfigModule {}
