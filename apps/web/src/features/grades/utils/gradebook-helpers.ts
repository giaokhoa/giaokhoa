import type { GradeItem } from '@giaokhoa/contracts';

export type VneduColumnKind = 'none' | 'regular' | 'midterm' | 'final';

export function isVneduExportableItem(item: GradeItem): boolean {
  return (item.itemType === 'manual' || item.itemType === 'mod') && (item.gradeType ?? 'value') === 'value';
}

export function guessVneduColumnKind(item: GradeItem): VneduColumnKind {
  const name = item.itemName.toLowerCase();
  if (/giữa\s*k[ỳì]|giua\s*ky|midterm|\bgk\b/.test(name)) return 'midterm';
  if (/cuối\s*k[ỳì]|cuoi\s*ky|học\s*k[ỳì]|hoc\s*ky|\bck\b|final/.test(name)) return 'final';
  return 'regular';
}

export function scoreLabel(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
