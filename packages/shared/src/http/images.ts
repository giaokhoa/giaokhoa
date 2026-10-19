import { z } from 'zod';
import {
  imageIdSchema,
  imageRefSchema,
  imageMimeTypeSchema,
  MAX_IMAGE_BYTES,
  tikzImageSourceSchema,
} from '../images.js';

export const uploadImageBodySchema = z
  .union([z.strictObject({}), tikzImageSourceSchema])
  .optional()
  .transform((value) => value ?? {});
export const discardImagesBodySchema = z.strictObject({
  images: z.array(imageRefSchema).max(100),
});
export const uploadedImageResponseSchema = z
  .strictObject({
    imageId: imageIdSchema,
    imageVariantId: imageIdSchema.nullable(),
    src: z.string(),
    width: z.int().positive(),
    height: z.int().positive(),
    mimeType: imageMimeTypeSchema,
  })
  .superRefine(({ imageId, imageVariantId, src }, ctx) => {
    const expectedSrc = imageVariantId
      ? `/images/${imageId}/variants/${imageVariantId}`
      : `/images/${imageId}`;
    if (src !== expectedSrc) {
      ctx.addIssue({ code: 'custom', path: ['src'], message: 'URL ảnh không hợp lệ' });
    }
  });

export const imageIdPathParamsSchema = z.strictObject({ id: imageIdSchema });
export const imageVariantPathParamsSchema = z.strictObject({
  id: imageIdSchema,
  imageVariantId: imageIdSchema,
});

export const imagesContract = {
  upload: {
    method: 'POST',
    path: '/images',
    file: { field: 'file', required: true, maxBytes: MAX_IMAGE_BYTES },
    body: uploadImageBodySchema,
    responses: { 201: uploadedImageResponseSchema },
  },
  discard: {
    method: 'POST',
    path: '/images/discard',
    body: discardImagesBodySchema,
    responses: { 204: null },
  },
  uploadVariant: {
    method: 'POST',
    path: '/images/:id/variants',
    pathParams: imageIdPathParamsSchema,
    file: { field: 'file', required: true, maxBytes: MAX_IMAGE_BYTES },
    responses: { 201: uploadedImageResponseSchema },
  },
  getSource: {
    method: 'GET',
    path: '/images/:id/source',
    pathParams: imageIdPathParamsSchema,
    responses: { 200: tikzImageSourceSchema },
  },
  get: {
    method: 'GET',
    path: '/images/:id',
    pathParams: imageIdPathParamsSchema,
    responses: { 200: 'binary' },
  },
  getVariant: {
    method: 'GET',
    path: '/images/:id/variants/:imageVariantId',
    pathParams: imageVariantPathParamsSchema,
    responses: { 200: 'binary' },
  },
} as const;

export type UploadImageBody = z.infer<typeof uploadImageBodySchema>;
export type DiscardImagesBody = z.infer<typeof discardImagesBodySchema>;
export type UploadedImageResponse = z.infer<typeof uploadedImageResponseSchema>;
