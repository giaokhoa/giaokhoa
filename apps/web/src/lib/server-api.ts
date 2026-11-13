import { problemDetailsSchema } from '@giaokhoa/contracts';
import { ApiError } from '#lib/api';

export const SSR_FETCH_TIMEOUT_MS = 10_000;

export function apiInternalBase(): string {
  return process.env.GIAOKHOA_API_INTERNAL_URL ?? 'http://127.0.0.1:3000';
}

function internalSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SSR_FETCH_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = problemDetailsSchema.safeParse(body);
  return new ApiError(
    parsed.success
      ? parsed.data
      : { type: 'about:blank', title: res.statusText, status: res.status, code: 'http.unknown' },
  );
}

export async function fetchApiJson(path: string, headers?: Record<string, string>): Promise<unknown> {
  try {
    const res = await fetch(`${apiInternalBase()}${path}`, { headers, signal: internalSignal() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchApiJsonOrThrow(
  path: string,
  headers?: Record<string, string>,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${apiInternalBase()}${path}`, {
    headers,
    signal: internalSignal(callerSignal),
  });
  if (!res.ok) throw await toApiError(res);
  return await res.json();
}

export async function fetchApiJsonForRequest(request: Request, path: string): Promise<unknown> {
  const cookie = request.headers.get('Cookie') ?? '';
  if (!cookie) return null;
  return fetchApiJson(path, { Cookie: cookie });
}

export async function fetchApiJsonForRequestOrThrow(
  request: Request,
  path: string,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  const cookie = request.headers.get('Cookie') ?? '';
  if (!cookie) return null;
  return fetchApiJsonOrThrow(path, { Cookie: cookie }, callerSignal);
}
