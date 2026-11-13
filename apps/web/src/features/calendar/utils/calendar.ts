
export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const zonedDayPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const zonedClockPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partNumber(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((p) => p.type === type)?.value ?? '0');
}

function zonedDateParts(instant: Date): { year: number; month: number; day: number } {
  const parts = zonedDayPartsFormatter.formatToParts(instant);
  return { year: partNumber(parts, 'year'), month: partNumber(parts, 'month'), day: partNumber(parts, 'day') };
}

function zonedOffsetMs(instant: Date): number {
  const parts = zonedClockPartsFormatter.formatToParts(instant);
  const asUtcMs = Date.UTC(
    partNumber(parts, 'year'),
    partNumber(parts, 'month') - 1,
    partNumber(parts, 'day'),
    partNumber(parts, 'hour'),
    partNumber(parts, 'minute'),
    partNumber(parts, 'second'),
  );
  return asUtcMs - Math.floor(instant.getTime() / 1000) * 1000;
}

function zonedMidnightUtcMs(year: number, month: number, day: number): number {
  const guessUtcMs = Date.UTC(year, month - 1, day);
  return guessUtcMs - zonedOffsetMs(new Date(guessUtcMs));
}

export function currentMonthRangeIso(now: Date = new Date()): { from: string; to: string } {
  const { year, month } = zonedDateParts(now);
  const fromMs = zonedMidnightUtcMs(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const toMs = zonedMidnightUtcMs(nextYear, nextMonth, 1) - 1;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

export function upcomingDaysRangeIso(days: number, now: Date = new Date()): { from: string; to: string } {
  const { year, month, day } = zonedDateParts(now);
  const fromMs = zonedMidnightUtcMs(year, month, day);
  return { from: new Date(fromMs).toISOString(), to: new Date(fromMs + days * 86_400_000).toISOString() };
}
