import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { RequireCapability } from '../../common/require-capability.decorator';
import { CustomFieldsService, isCustomFieldType, type FieldConfig } from './custom-fields.service';
import { createCustomFieldCategorySchema, createCustomFieldSchema, type CreateCategoryDto, type CreateFieldDto } from './dto/custom-fields.dto';

/**
 * Chuyển `configData` thô từ DTO (`Record<string, unknown>` ở `@giaokhoa/contracts`)
 * thành `FieldConfig` của service: chỉ giữ 4 khoá mà `FieldConfig` định nghĩa, khoá
 * đã biết sai kiểu thì từ chối 400 ngay tại biên thay vì ghi rồi mới vỡ khi đọc.
 * Khoá lạ bị bỏ vì `validateValue` chỉ đọc 4 khoá này nên chúng không có hiệu lực.
 */
function parseFieldConfig(configData: Record<string, unknown> | undefined): FieldConfig | undefined {
  if (configData === undefined) return undefined;
  const invalid = (msg: string): never => { throw new BadRequestException({ message: msg, code: 'customfield.invalid_config' }); };
  const config: FieldConfig = {};
  const required = configData.required;
  if (typeof required === 'boolean') config.required = required;
  else if (required !== undefined) invalid('configData.required must be a boolean');
  const options = configData.options;
  if (options !== undefined) {
    if (Array.isArray(options) && options.every((option): option is string => typeof option === 'string')) config.options = options;
    else invalid('configData.options must be an array of strings');
  }
  const defaultvalue = configData.defaultvalue;
  if (typeof defaultvalue === 'string') config.defaultvalue = defaultvalue;
  else if (defaultvalue !== undefined) invalid('configData.defaultvalue must be a string');
  const maxlength = configData.maxlength;
  if (typeof maxlength === 'number' && Number.isFinite(maxlength)) config.maxlength = maxlength;
  else if (maxlength !== undefined) invalid('configData.maxlength must be a number');
  return config;
}


@ApiTags('custom-fields')
@Controller({ path: 'custom-fields', version: '1' })
/**
 * API định nghĩa trường tuỳ biến (quản trị): category và field.
 */
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}
  @Post('categories')
  @RequireCapability('customfield:manage')
  /**
   * POST /custom-fields/categories — tạo category.
   */
  async createCategory(@Body({ schema: createCustomFieldCategorySchema }) dto: CreateCategoryDto) { return this.service.createCategory(dto); }
  @Get('categories')
  @RequireCapability('customfield:manage')
  /**
   * GET /custom-fields/categories — liệt kê category theo component/area.
   */
  async listCategories(@Query('component') component = 'core_user', @Query('area') area = 'user') { return this.service.listCategories(component, area); }
  @Delete('categories/:id')
  @RequireCapability('customfield:manage')
  /**
   * DELETE /custom-fields/categories/:id — xoá category.
   */
  async deleteCategory(@Param('id', { schema: uuidIdSchema }) id: string) { await this.service.deleteCategory(id); return { deleted: true }; }
  @Post('fields')
  @RequireCapability('customfield:manage')
  /**
   * POST /custom-fields/categories/:id/fields — thêm field vào category.
   */
  async createField(@Body({ schema: createCustomFieldSchema }) dto: CreateFieldDto) {
    if (!isCustomFieldType(dto.type)) {
      throw new BadRequestException({ message: `Unsupported field type ${dto.type}`, code: 'customfield.invalid_type' });
    }
    return this.service.createField(dto.categoryId, { ...dto, type: dto.type, configData: parseFieldConfig(dto.configData) });
  }
  @Get('fields')
  @RequireCapability('customfield:manage')
  /**
   * GET /custom-fields/categories/:id/fields — liệt kê field.
   */
  async listFields(@Query('component') component = 'core_user', @Query('area') area = 'user') { return this.service.listFields(component, area); }
  @Delete('fields/:id')
  @RequireCapability('customfield:manage')
  /**
   * DELETE /custom-fields/fields/:id — xoá field.
   */
  async deleteField(@Param('id', { schema: uuidIdSchema }) id: string) { await this.service.deleteField(id); return { deleted: true }; }
}
