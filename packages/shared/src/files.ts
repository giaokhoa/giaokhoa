import { z } from 'zod';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TIKZ_SOURCE_LENGTH = 100_000;
export const fileIdSchema = z.uuidv7();

export const fileMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

export const tikzFileSourceSchema = z.strictObject({
  kind: z.literal('tikz'),
  source: z
    .string()
    .max(MAX_TIKZ_SOURCE_LENGTH)
    .refine((source) => source.trim().length > 0, 'Mã TikZ không được để trống'),
});

export const fileRefSchema = z.strictObject({
  fileId: fileIdSchema,
  variantFileId: fileIdSchema.nullable(),
});

export type FileMimeType = z.infer<typeof fileMimeTypeSchema>;
export type TikzFileSource = z.infer<typeof tikzFileSourceSchema>;
export type FileRef = z.infer<typeof fileRefSchema>;

/** Chỉ cho phép URL nội bộ dạng url(#id) trong SVG từ TikZ. */
export function hasUnsafeSvgCss(css: string): boolean {
  const normalized = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // CSS escape có thể che dấu `url` hoặc `@import`: từ chối thay vì diễn giải CSS.
  if (normalized.includes('\\') || normalized.includes('@')) return true;
  const withoutLocalReferences = normalized.replace(
    /url\s*\(\s*(['"]?)#[a-zA-Z_][\w.:-]*\1\s*\)/gi,
    '',
  );
  return /\burl\s*\(|\bimage-set\s*\(|https?:|data:/i.test(withoutLocalReferences);
}

export function fileUrl({ fileId, variantFileId }: FileRef): string {
  return variantFileId ? `/files/${fileId}/variants/${variantFileId}` : `/files/${fileId}`;
}
