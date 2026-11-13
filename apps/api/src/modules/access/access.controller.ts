import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { RequireCapability } from '../../common/require-capability.decorator';
import { ContextsService } from './contexts.service';
import { assignRoleSchema, capabilityMatrixQuerySchema, createContextSchema, createRoleSchema, hasCapabilityQueryServerSchema, listAssignmentsQueryServerSchema, listUsersWithAssignmentsQueryServerSchema, overrideCapabilitySchema, replaceRoleCapabilitiesSchema, updateRoleSchema, type AssignRoleDto, type CapabilityMatrixQueryDto, type CreateContextDto, type CreateRoleDto, type HasCapabilityQueryDto, type ListAssignmentsQueryDto, type ListUsersWithAssignmentsQueryDto, type OverrideCapabilityDto, type ReplaceRoleCapabilitiesDto, type UpdateRoleDto } from './dto/access.dto';
import { PermissionEvaluator } from './permission-evaluator.service';
import { RolesService } from './roles.service';

@ApiTags('access')
@Controller({ path: 'access', version: '1' })
export class AccessController {
  constructor(
    private readonly contexts: ContextsService,
    private readonly roles: RolesService,
    private readonly evaluator: PermissionEvaluator,
  ) {}

  @Post('contexts')
  @RequireCapability('site:config')
  async createContext(@Body({ schema: createContextSchema }) dto: CreateContextDto) {
    return this.contexts.createContext(dto.contextLevel, dto.instanceId, dto.parentId);
  }
  @Get('contexts')
  @RequireCapability('role:manage')
  async listContexts() { return this.contexts.listContexts(); }
  @Get('contexts/:id')
  @RequireCapability('role:manage')
  async getContext(@Param('id', { schema: uuidIdSchema }) id: string) { return this.contexts.getContext(id); }

  @Post('roles')
  @RequireCapability('role:manage')
  async createRole(@Body({ schema: createRoleSchema }) dto: CreateRoleDto) { return this.roles.createRole(dto); }
  @Get('roles')
  @RequireCapability('role:manage')
  async listRoles() { return this.roles.listRoles(); }
  @Get('roles/:id')
  @RequireCapability('role:manage')
  async getRole(@Param('id', { schema: uuidIdSchema }) id: string) { return this.roles.getRole(id); }
  @Patch('roles/:id')
  @RequireCapability('role:manage')
  async updateRole(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateRoleSchema }) dto: UpdateRoleDto) { return this.roles.updateRole(id, dto); }
  @Delete('roles/:id')
  @RequireCapability('role:manage')
  async deleteRole(@Param('id', { schema: uuidIdSchema }) id: string) { await this.roles.deleteRole(id); return { deleted: true }; }

  @Get('capabilities')
  @RequireCapability('role:manage')
  async listCapabilities() { return this.roles.listCapabilities(); }
  @Get('roles/:id/capabilities')
  @RequireCapability('role:manage')
  async listRoleCapabilities(@Param('id', { schema: uuidIdSchema }) id: string) { return this.roles.listRoleCapabilities(id); }
  @Get('capability-matrix')
  @RequireCapability('role:manage')
  async getCapabilityMatrix(@Query({ schema: capabilityMatrixQuerySchema }) query: CapabilityMatrixQueryDto) {
    return this.roles.getCapabilityMatrix(query.contextId);
  }
  @Put('roles/:id/capabilities')
  @RequireCapability('role:override', 'body:contextId')
  async replaceRoleCapabilities(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: replaceRoleCapabilitiesSchema }) dto: ReplaceRoleCapabilitiesDto, @CurrentUser() actor: AuthenticatedUser) {
    const overrides = await this.roles.replaceRoleCapabilities(id, dto.contextId, dto.overrides, actor.id);
    return { roleId: id, contextId: dto.contextId, overrides };
  }

  @Post('assignments')
  @RequireCapability('role:assign')
  async assign(@Body({ schema: assignRoleSchema }) dto: AssignRoleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roles.assignRole(dto.userId, dto.roleId, dto.contextId, actor.id);
  }
  @Get('assignments')
  @RequireCapability('role:assign')
  async listAssignments(@Query({ schema: listAssignmentsQueryServerSchema }) query: ListAssignmentsQueryDto) {
    return this.roles.listAssignmentsPage(
      { userId: query.userId, contextId: query.contextId, roleId: query.roleId, search: query.search },
      query.page,
      query.pageSize,
    );
  }
  @Get('users-with-assignments')
  @RequireCapability('role:assign')
  async listUsersWithAssignments(@Query({ schema: listUsersWithAssignmentsQueryServerSchema }) query: ListUsersWithAssignmentsQueryDto) {
    return this.roles.listUsersWithAssignmentsPage(
      { search: query.search, roleId: query.roleId, status: query.status },
      query.page,
      query.pageSize,
    );
  }
  @Delete('assignments/:id')
  @RequireCapability('role:assign')
  async unassign(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { await this.roles.unassignRole(id, actor.id); return { deleted: true }; }

  @Post('overrides')
  @RequireCapability('role:override', 'body:contextId')
  async override(@Body({ schema: overrideCapabilitySchema }) dto: OverrideCapabilityDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.roles.setCapabilityOverride(dto.roleId, dto.capability, dto.contextId, dto.permission, actor.id);
    return { updated: true };
  }

  @Get('has-capability')
  @RequireCapability('role:manage')
  async hasCapability(@Query({ schema: hasCapabilityQueryServerSchema }) query: HasCapabilityQueryDto) {
    const allowed = await this.evaluator.hasCapability(query.userId, query.capability, query.contextId);
    return { userId: query.userId, capability: query.capability, contextId: query.contextId, allowed };
  }
}
