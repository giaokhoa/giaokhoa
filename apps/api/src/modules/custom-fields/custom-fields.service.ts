import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../../common/http-errors';
import { CustomFieldsRepository, type FieldRow } from '@giaokhoa/db/repositories/custom-fields';

export type CustomFieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'date';
export interface FieldConfig { required?: boolean; options?: string[]; defaultvalue?: string; maxlength?: number }
export const FIELD_TYPES: CustomFieldType[] = ['text', 'textarea', 'select', 'checkbox', 'date'];

@Injectable()
export class CustomFieldsService {
  constructor(private readonly repo: CustomFieldsRepository) {}

  async createCategory(input: { name: string; component: string; area: string }): Promise<unknown> {
    const existing = await this.repo.listCategories(input.component, input.area);
    return this.repo.insertCategory({ ...input, sortOrder: existing.length });
  }
  async listCategories(component: string, area: string): Promise<unknown[]> { return this.repo.listCategories(component, area); }
  async deleteCategory(id: string): Promise<void> {
    if (!(await this.repo.getCategory(id))) notFound(`Category ${id} not found`, 'customfield.category_not_found');
    await this.repo.deleteCategory(id);
  }
  async createField(categoryId: string, input: { shortName: string; name: string; type: string; configData?: FieldConfig }): Promise<FieldRow> {
    const category = await this.repo.getCategory(categoryId);
    if (!category) notFound(`Category ${categoryId} not found`, 'customfield.category_not_found');
    if (!FIELD_TYPES.includes(input.type as CustomFieldType)) {
      badRequest(`Unsupported field type ${input.type}`, 'customfield.invalid_type');
    }
    const siblings = await this.repo.listFieldsByCategory(categoryId);
    if (siblings.some((f) => f.shortName === input.shortName)) {
      badRequest(`Field shortName ${input.shortName} already exists in category`, 'customfield.shortname_taken');
    }
    return this.repo.insertField({ categoryId, shortName: input.shortName, name: input.name, type: input.type, configData: input.configData ?? {}, sortOrder: siblings.length });
  }
  async listFields(component: string, area: string): Promise<FieldRow[]> {
    const categories = await this.repo.listCategories(component, area);
    const all: FieldRow[] = [];
    for (const c of categories) all.push(...(await this.repo.listFieldsByCategory(c.id)));
    return all;
  }
  async deleteField(id: string): Promise<void> {
    if (!(await this.repo.getField(id))) notFound(`Field ${id} not found`, 'customfield.field_not_found');
    await this.repo.deleteField(id);
  }

  validateValue(field: FieldRow, raw: string | undefined | null): string | null {
    const config = (field.configData ?? {}) as FieldConfig;
    const value = raw ?? '';
    if (config.required && value.trim() === '') return `Field ${field.shortName} is required`;
    if (value === '') return null;
    switch (field.type) {
      case 'text':
        if (config.maxlength && value.length > config.maxlength) return `Field ${field.shortName} exceeds ${config.maxlength} characters`;
        return null;
      case 'textarea': return null;
      case 'select':
        return (config.options ?? []).includes(value) ? null : `Field ${field.shortName} must be one of: ${(config.options ?? []).join(', ')}`;
      case 'checkbox':
        return ['0', '1', 'true', 'false'].includes(value) ? null : `Field ${field.shortName} must be a boolean value`;
      case 'date':
        return Number.isNaN(Date.parse(value)) ? `Field ${field.shortName} must be a valid date` : null;
      default: return `Unknown field type ${field.type}`;
    }
  }

  async validateValuesForInstance(component: string, area: string, values: Record<string, string>): Promise<void> {
    const fields = await this.listFields(component, area);
    const errors: string[] = [];
    for (const field of fields) {
      const err = this.validateValue(field, values[field.shortName]);
      if (err) errors.push(err);
    }
    if (errors.length) badRequest(errors.join('; '), 'customfield.validation_failed');
  }

  async setValuesForInstance(component: string, area: string, instanceId: string, values: Record<string, string>): Promise<void> {
    const fields = await this.listFields(component, area);
    const errors: string[] = [];
    for (const field of fields) {
      const err = this.validateValue(field, values[field.shortName]);
      if (err) errors.push(err);
    }
    if (errors.length) badRequest(errors.join('; '), 'customfield.validation_failed');
    for (const field of fields) {
      if (values[field.shortName] !== undefined) await this.repo.upsertData(field.id, instanceId, values[field.shortName]!);
    }
  }
  async getValuesForInstance(component: string, area: string, instanceId: string): Promise<{ field: FieldRow; value: string | null }[]> {
    const fields = await this.listFields(component, area);
    const data = await this.repo.getDataForInstance(fields.map((f) => f.id), instanceId);
    return fields.map((field) => ({ field, value: data.find((d) => d.fieldId === field.id)?.value ?? null }));
  }

  async getValuesForInstances(
    component: string, area: string, instanceIds: string[],
  ): Promise<Map<string, { field: FieldRow; value: string | null }[]>> {
    const fields = await this.listFields(component, area);
    const data = await this.repo.getDataForInstances(fields.map((f) => f.id), instanceIds);
    const valueByInstanceField = new Map<string, string | null>();
    for (const d of data) {
      const key = `${d.instanceId}:${d.fieldId}`;
      if (!valueByInstanceField.has(key)) valueByInstanceField.set(key, d.value);
    }
    const result = new Map<string, { field: FieldRow; value: string | null }[]>();
    for (const instanceId of instanceIds) {
      result.set(instanceId, fields.map((field) => ({
        field, value: valueByInstanceField.get(`${instanceId}:${field.id}`) ?? null,
      })));
    }
    return result;
  }
}
