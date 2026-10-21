import { z } from 'zod';
import {
  fileIdSchema,
  fileRefSchema,
  fileMimeTypeSchema,
  MAX_FILE_BYTES,
  tikzFileSourceSchema,
  fileUrl,
} from '../files.js';

export const uploadFileBodySchema = z
  .union([z.strictObject({}), tikzFileSourceSchema])
  .optional()
  .transform((value) => value ?? {});
export const discardFilesBodySchema = z.strictObject({
  files: z.array(fileRefSchema).max(100),
});
export const uploadedFileResponseSchema = z
  .strictObject({
    fileId: fileIdSchema,
    variantFileId: fileIdSchema.nullable(),
    src: z.string(),
    width: z.int().positive(),
    height: z.int().positive(),
    mimeType: fileMimeTypeSchema,
  })
  .superRefine(({ fileId, variantFileId, src }, ctx) => {
    if (src !== fileUrl({ fileId, variantFileId })) {
      ctx.addIssue({ code: 'custom', path: ['src'], message: 'URL file không hợp lệ' });
    }
  });

export const fileIdPathParamsSchema = z.strictObject({ id: fileIdSchema });
export const fileVariantPathParamsSchema = z.strictObject({
  id: fileIdSchema,
  variantId: fileIdSchema,
});

export const filesContract = {
  upload: {
    method: 'POST',
    path: '/files',
    file: { field: 'file', required: true, maxBytes: MAX_FILE_BYTES },
    body: uploadFileBodySchema,
    responses: { 201: uploadedFileResponseSchema },
  },
  discard: {
    method: 'POST',
    path: '/files/discard',
    body: discardFilesBodySchema,
    responses: { 204: null },
  },
  uploadVariant: {
    method: 'POST',
    path: '/files/:id/variants',
    pathParams: fileIdPathParamsSchema,
    file: { field: 'file', required: true, maxBytes: MAX_FILE_BYTES },
    responses: { 201: uploadedFileResponseSchema },
  },
  getSource: {
    method: 'GET',
    path: '/files/:id/source',
    pathParams: fileIdPathParamsSchema,
    responses: { 200: tikzFileSourceSchema },
  },
  get: {
    method: 'GET',
    path: '/files/:id',
    pathParams: fileIdPathParamsSchema,
    responses: { 200: 'binary' },
  },
  getVariant: {
    method: 'GET',
    path: '/files/:id/variants/:variantId',
    pathParams: fileVariantPathParamsSchema,
    responses: { 200: 'binary' },
  },
} as const;

export type UploadFileBody = z.infer<typeof uploadFileBodySchema>;
export type DiscardFilesBody = z.infer<typeof discardFilesBodySchema>;
export type UploadedFileResponse = z.infer<typeof uploadedFileResponseSchema>;
