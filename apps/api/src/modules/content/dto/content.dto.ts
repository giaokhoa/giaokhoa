import {
  createLessonTemplateSchema, createPageSchema, createResourceSchema, recordProgressSchema,
  updatePageSchema, updateResourceSchema,
  type CreateLessonTemplate, type CreatePage, type CreateResource, type RecordProgress, type UpdatePage, type UpdateResource,
} from '@giaokhoa/contracts';

export { createLessonTemplateSchema, createPageSchema, createResourceSchema, recordProgressSchema, updatePageSchema, updateResourceSchema };
export type CreatePageDto = CreatePage;
export type UpdatePageDto = UpdatePage;
export type CreateResourceDto = CreateResource;
export type UpdateResourceDto = UpdateResource;
export type RecordProgressDto = RecordProgress;
export type CreateLessonTemplateDto = CreateLessonTemplate;
