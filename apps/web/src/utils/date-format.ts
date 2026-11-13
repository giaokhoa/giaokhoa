
export type DateInput = Date | string;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(value: DateInput, locale?: string): string {
  return toDate(value).toLocaleDateString(locale);
}

export function formatDateTime(value: DateInput, locale?: string): string {
  return toDate(value).toLocaleString(locale);
}

export function formatTime(value: DateInput, locale?: string): string {
  return toDate(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatWithOptions(
  value: DateInput,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(toDate(value));
}
