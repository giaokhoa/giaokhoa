import type { ProblemDetails } from '@giaokhoa/contracts';
import { problemDetailsSchema } from '@giaokhoa/contracts';


export function redirectToExternalUrl(url: string): void {
  window.location.href = url;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
}

export class TwoFactorRedirectError extends Error {
  constructor() {
    super('Two-factor authentication is required to finish signing in');
    this.name = 'TwoFactorRedirectError';
  }
}

async function parseProblem(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = problemDetailsSchema.safeParse(body);
  return new ApiError(
    parsed.success
      ? parsed.data
      : { type: 'about:blank', title: res.statusText, status: res.status, code: 'http.unknown' },
  );
}

export function apiErrorFromAuthClient(error: { status?: number; code?: string; message?: string }): ApiError {
  const status = error.status ?? 400;
  const message = error.message ?? 'Yêu cầu thất bại';
  return new ApiError({
    type: 'about:blank',
    title: message,
    status,
    detail: message,
    code: error.code ?? 'auth.request_failed',
  });
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw await parseProblem(res);
  return (await res.json()) as T;
}
