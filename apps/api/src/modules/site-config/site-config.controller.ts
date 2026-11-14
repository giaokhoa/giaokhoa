import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { RequireCapability } from '../../common/require-capability.decorator';
import { TenantConfigService } from '../tenants/tenant-config.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { SiteConfigService } from './site-config.service';
import { setSiteSettingSchema, type SetSettingDto } from './dto/site-config.dto';

@ApiTags('site-config')
@Controller({ path: 'site-config', version: '1' })
export class SiteConfigController {
  constructor(
    private readonly service: SiteConfigService,
    private readonly tenantConfig: TenantConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private activeTenantId(): string {
    const tenantId = this.tenantContext.currentTenantId();
    if (!tenantId) {
      throw new BadRequestException({ message: 'No active tenant in this request', code: 'tenant.context_missing' });
    }
    return tenantId;
  }

  @Get('tenant-settings')
  async listTenantSettings(@CurrentUser() actor: AuthenticatedUser) {
    return this.tenantConfig.listForTenant(actor.id, this.activeTenantId());
  }

  @Put('tenant-settings/:component/:name')
  async setTenantSetting(
    @Param('component', { schema: z.string().trim().min(1) }) component: string,
    @Param('name', { schema: z.string().trim().min(1) }) name: string,
    @Body({ schema: setSiteSettingSchema }) dto: SetSettingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenantConfig.setForTenant(actor.id, this.activeTenantId(), component, name, dto.value);
  }

  @Delete('tenant-settings/:component/:name')
  async clearTenantSetting(
    @Param('component', { schema: z.string().trim().min(1) }) component: string,
    @Param('name', { schema: z.string().trim().min(1) }) name: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenantConfig.clearForTenant(actor.id, this.activeTenantId(), component, name);
  }

  @Get()
  @RequireCapability('site:config')
  async list() {
    return this.service.listSettings();
  }

  @Get('audit')
  @RequireCapability('site:config')
  async audit(@Query('settingKey', { schema: z.string().trim().min(1).optional() }) settingKey?: string) {
    return this.service.listAudit(settingKey);
  }

  @Get(':component/:name')
  @RequireCapability('site:config')
  async get(@Param('component', { schema: z.string().trim().min(1) }) component: string, @Param('name', { schema: z.string().trim().min(1) }) name: string) {
    return this.service.getSetting(component, name);
  }

  @Put(':component/:name')
  @RequireCapability('site:config')
  async set(
    @Param('component', { schema: z.string().trim().min(1) }) component: string,
    @Param('name', { schema: z.string().trim().min(1) }) name: string,
    @Body({ schema: setSiteSettingSchema }) dto: SetSettingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.setSetting(actor.id, component, name, dto.value);
  }

  @Delete(':component/:name')
  @RequireCapability('site:config')
  async clear(
    @Param('component', { schema: z.string().trim().min(1) }) component: string,
    @Param('name', { schema: z.string().trim().min(1) }) name: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.clearSetting(actor.id, component, name);
  }
}
