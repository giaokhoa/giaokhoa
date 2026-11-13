import {
  createContentBankContentSchema,
  insertContentBankContentSchema,
  reviewContentBankContentSchema,
  updateContentBankContentSchema,
  uploadContentBankFileSchema,
  type CreateContentBankContent,
  type InsertContentBankContent,
  type ReviewContentBankContent,
  type UpdateContentBankContent,
  type UploadContentBankFile,
} from '@giaokhoa/contracts';

export { createContentBankContentSchema, insertContentBankContentSchema, reviewContentBankContentSchema, updateContentBankContentSchema, uploadContentBankFileSchema };
export type CreateContentDto = CreateContentBankContent;
export type UpdateContentDto = UpdateContentBankContent;
export type UploadContentFileDto = UploadContentBankFile;
export type ReviewContentDto = ReviewContentBankContent;
export type InsertContentDto = InsertContentBankContent;
