import { createHash } from 'node:crypto';


export interface ContentViolation {
  fieldPath: string;
  message: string;
}

function containsForbiddenControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) return true;
  }
  return false;
}
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/;

function scanString(value: string, fieldPath: string, out: ContentViolation[]): void {
  if (containsForbiddenControl(value)) {
    out.push({ fieldPath, message: 'Content contains forbidden control characters' });
  }
  if (INVISIBLE_CHARS.test(value)) {
    out.push({ fieldPath, message: 'Content contains forbidden zero-width or bidirectional control characters' });
  }
}

export function scanContent(payload: unknown, out: ContentViolation[], path = '', skipPaths: ReadonlySet<string> = new Set()): void {
  if (typeof payload === 'string') {
    if (!skipPaths.has(path)) scanString(payload, path || '/', out);
    return;
  }
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => scanContent(item, out, `${path}/${index}`, skipPaths));
    return;
  }
  if (typeof payload === 'object' && payload !== null) {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      scanContent(value, out, `${path}/${key}`, skipPaths);
    }
  }
}

export function normalizeContentStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\r\n?/g, '\n').normalize('NFC') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeContentStrings(item)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeContentStrings(item);
    }
    return out as T;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function mcpRequestHash(tool: string, payload: unknown): string {
  return createHash('sha256').update(`${tool}|${stableStringify(payload)}`).digest('hex');
}
