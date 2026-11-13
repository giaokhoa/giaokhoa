
export interface IcsExportEvent {
  id: string;
  name: string;
  description: string;
  location: string;
  timeStart: Date;
  timeDuration: number;
  updatedAt: Date;
}

export function formatIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function serializeCalendar(events: IcsExportEvent[], options: { calName?: string } = {}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Giáo khoa//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (options.calName) lines.push(`X-WR-CALNAME:${escapeIcsText(options.calName)}`);
  for (const event of events) {
    const end = new Date(event.timeStart.getTime() + Math.max(0, event.timeDuration) * 1000);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@giaokhoa`);
    lines.push(`DTSTAMP:${formatIcsDate(event.updatedAt)}`);
    lines.push(`DTSTART:${formatIcsDate(event.timeStart)}`);
    lines.push(`DTEND:${formatIcsDate(end)}`);
    lines.push(`SUMMARY:${escapeIcsText(event.name)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
