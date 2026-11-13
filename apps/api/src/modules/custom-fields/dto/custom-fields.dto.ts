import {
  createCustomFieldCategorySchema,
  createCustomFieldSchema,
  type CreateCustomField,
  type CreateCustomFieldCategory,
} from '@giaokhoa/contracts';

export { createCustomFieldCategorySchema, createCustomFieldSchema };
export type CreateCategoryDto = CreateCustomFieldCategory;
export type CreateFieldDto = CreateCustomField;
