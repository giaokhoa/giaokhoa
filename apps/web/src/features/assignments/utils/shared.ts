import { formatWithOptions } from '#utils/date-format';


export const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';

export function dateLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatWithOptions(d, undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

