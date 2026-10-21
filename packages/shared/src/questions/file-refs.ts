import type { FileRef } from '../files.js';

export function collectFileRefs(value: unknown): FileRef[] {
  const refs = new Map<string, FileRef>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (record.type === 'image' && record.attrs && typeof record.attrs === 'object') {
      const attrs = record.attrs as Record<string, unknown>;
      if (typeof attrs.fileId === 'string') {
        const variantFileId = typeof attrs.variantFileId === 'string' ? attrs.variantFileId : null;
        refs.set(`${attrs.fileId}:${variantFileId ?? ''}`, {
          fileId: attrs.fileId,
          variantFileId,
        });
      }
    }

    for (const child of Object.values(record)) visit(child);
  }

  visit(value);
  return [...refs.values()];
}
