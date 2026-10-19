import type { ImageRef } from '../images.js';

export function collectImageRefs(value: unknown): ImageRef[] {
  const refs = new Map<string, ImageRef>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (record.type === 'image' && record.attrs && typeof record.attrs === 'object') {
      const attrs = record.attrs as Record<string, unknown>;
      if (typeof attrs.imageId === 'string') {
        const imageVariantId =
          typeof attrs.imageVariantId === 'string' ? attrs.imageVariantId : null;
        refs.set(`${attrs.imageId}:${imageVariantId ?? ''}`, {
          imageId: attrs.imageId,
          imageVariantId,
        });
      }
    }

    for (const child of Object.values(record)) visit(child);
  }

  visit(value);
  return [...refs.values()];
}
