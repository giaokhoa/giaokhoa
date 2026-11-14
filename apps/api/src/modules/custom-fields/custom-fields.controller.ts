import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireCapability } from '../../common/require-capability.decorator';
import { CustomFieldsService, type FieldConfig } from './custom-fields.service';
import { createCustomFieldCategorySchema, createCustomFieldSchema, type CreateCategoryDto, type CreateFieldDto } from './dto/custom-fields.dto';


@ApiTags('custom-fields')
@Controller({ path: 'custom-fields', version: '1' })
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}
  @Post('categories')
  @RequireCapability('customfield:manage')
  async createCategory(@Body({ schema: createCustomFieldCategorySchema }) dto: CreateCategoryDto) { return this.service.createCategory(dto); }
  @Get('categories')
  @RequireCapability('customfield:manage')
  async listCategories(@Query('component', { schema: z.string().trim().min(1).optional() }) component = 'core_user', @Query('area', { schema: z.string().trim().min(1).optional() }) area = 'user') { return this.service.listCategories(component, area); }
  @Delete('categories/:id')
  @RequireCapability('customfield:manage')
  async deleteCategory(@Param('id', { schema: uuidIdSchema }) id: string) { await this.service.deleteCategory(id); return { deleted: true }; }
  @Post('fields')
  @RequireCapability('customfield:manage')
  async createField(@Body({ schema: createCustomFieldSchema }) dto: CreateFieldDto) { return this.service.createField(dto.categoryId, { ...dto, configData: dto.configData as FieldConfig | undefined }); }
  @Get('fields')
  @RequireCapability('customfield:manage')
  async listFields(@Query('component', { schema: z.string().trim().min(1).optional() }) component = 'core_user', @Query('area', { schema: z.string().trim().min(1).optional() }) area = 'user') { return this.service.listFields(component, area); }
  @Delete('fields/:id')
  @RequireCapability('customfield:manage')
  async deleteField(@Param('id', { schema: uuidIdSchema }) id: string) { await this.service.deleteField(id); return { deleted: true }; }
}
