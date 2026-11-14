import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { PlatformRoute } from '../../common/platform-route.decorator';
import { SkipSpaceContext } from '../tenants/skip-space-context.decorator';
import { ControlPlaneRegistryService } from './control-plane.service';
import {
  changeSpaceStatusSchema,
  createSpaceRegistrationSchema,
  recordSpaceSchemaMigrationRunSchema,
  updateSpaceRegistrationSchema,
  updateSpaceSchemaRegistrySchema,
  type ChangeSpaceStatusDto,
  type CreateSpaceRegistrationDto,
  type RecordSpaceSchemaMigrationRunDto,
  type UpdateSpaceRegistrationDto,
  type UpdateSpaceSchemaRegistryDto,
} from './dto/control-plane.dto';

@PlatformRoute()
@SkipSpaceContext()
@Controller({ path: 'control-plane/spaces', version: '1' })
export class ControlPlaneController {
  constructor(private readonly registry: ControlPlaneRegistryService) {}

  @Post()
  async create(@Body({ schema: createSpaceRegistrationSchema }) dto: CreateSpaceRegistrationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.registry.createRegistration(actor.id, dto);
  }

  @Get('by-slug/:slug')
  async bySlug(@Param('slug', { schema: z.string().trim().min(1).max(63) }) slug: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.registry.getBySlug(actor.id, slug);
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: updateSpaceRegistrationSchema }) dto: UpdateSpaceRegistrationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.registry.updateRegistration(actor.id, id, dto);
  }

  @Post(':id/status')
  async changeStatus(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: changeSpaceStatusSchema }) dto: ChangeSpaceStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.registry.changeStatus(actor.id, id, dto);
  }

  @Get(':id/history')
  async history(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.registry.listHistory(actor.id, id);
  }

  @Get(':id/schema-registry')
  async getSchemaRegistry(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.registry.getSchemaRegistry(actor.id, id);
  }

  @Put(':id/schema-registry')
  async updateSchemaRegistry(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: updateSpaceSchemaRegistrySchema }) dto: UpdateSpaceSchemaRegistryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.registry.updateSchemaRegistry(actor.id, id, dto);
  }

  @Get(':id/schema-migration-runs')
  async listMigrationRuns(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.registry.listMigrationRuns(actor.id, id);
  }

  @Post(':id/schema-migration-runs')
  async recordMigrationRun(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: recordSpaceSchemaMigrationRunSchema }) dto: RecordSpaceSchemaMigrationRunDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.registry.recordMigrationRun(actor.id, id, dto);
  }
}
