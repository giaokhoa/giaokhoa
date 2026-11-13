import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { TenantsService, toTenantDto } from './tenants.service';
import { TenantContextService } from './tenant-context.service';
import {
  addTenantMemberSchema,
  createTenantSchema,
  createUserSchema,
  updateTenantMemberSchema,
  updateTenantSchema,
  type AddTenantMemberDto,
  type CreateTenantDto,
  type CreateTenantUserDto,
  type UpdateTenantDto,
  type UpdateTenantMemberDto,
} from './dto/tenants.dto';

@ApiTags('tenants')
@Controller({ path: 'tenants', version: '1' })
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.tenants.listTenants(actor.id);
  }

  @Post()
  async create(@Body({ schema: createTenantSchema }) dto: CreateTenantDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.tenants.createTenant(actor.id, dto);
  }

  @Get('current')
  async current(@CurrentUser() actor: AuthenticatedUser) {
    const tenantId = this.tenantContext.currentTenantId();
    const tenant = tenantId ? await this.tenants.getTenant(tenantId) : await this.tenants.resolveDefaultTenant(actor.id);
    return toTenantDto(tenant);
  }

  @Get(':tenantId')
  async get(@Param('tenantId', { schema: uuidIdSchema }) tenantId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.tenants.getTenantForActor(actor.id, tenantId);
  }

  @Patch(':tenantId')
  async update(
    @Param('tenantId', { schema: uuidIdSchema }) tenantId: string,
    @Body({ schema: updateTenantSchema }) dto: UpdateTenantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.updateTenant(actor.id, tenantId, dto);
  }

  @Get(':tenantId/members')
  async members(@Param('tenantId', { schema: uuidIdSchema }) tenantId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.tenants.listMembers(actor.id, tenantId);
  }

  @Post(':tenantId/members')
  async addMember(
    @Param('tenantId', { schema: uuidIdSchema }) tenantId: string,
    @Body({ schema: addTenantMemberSchema }) dto: AddTenantMemberDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.addMember(actor.id, tenantId, dto);
  }

  @Patch(':tenantId/members/:userId')
  async setMemberStatus(
    @Param('tenantId', { schema: uuidIdSchema }) tenantId: string,
    @Param('userId', { schema: uuidIdSchema }) userId: string,
    @Body({ schema: updateTenantMemberSchema }) dto: UpdateTenantMemberDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.setMemberStatus(actor.id, tenantId, userId, dto.status);
  }

  @Get(':tenantId/users')
  async users(@Param('tenantId', { schema: uuidIdSchema }) tenantId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.tenants.listTenantUsers(actor.id, tenantId);
  }

  @Post(':tenantId/users')
  async createUser(
    @Param('tenantId', { schema: uuidIdSchema }) tenantId: string,
    @Body({ schema: createUserSchema }) dto: CreateTenantUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.createTenantUser(actor.id, tenantId, dto);
  }
}
