import { z } from 'zod';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const imageIdSchema = z.uuidv7();

export const imageMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

export const tikzImageSourceSchema = z.strictObject({
  kind: z.literal('tikz'),
  source: z
    .string()
    .max(100_000)
    .refine((source) => source.trim().length > 0, 'Mã TikZ không được để trống'),
});

export const imageRefSchema = z.strictObject({
  imageId: imageIdSchema,
  imageVariantId: imageIdSchema.nullable(),
});

export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;
export type TikzImageSource = z.infer<typeof tikzImageSourceSchema>;
export type ImageRef = z.infer<typeof imageRefSchema>;
