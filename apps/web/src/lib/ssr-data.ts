import { dehydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { createQueryClient } from '#lib/query-client';
import { fetchApiJsonForRequest, fetchApiJsonForRequestOrThrow } from '#lib/server-api';

export interface SsrLoaderData {
  dehydratedState: DehydratedState;
}

export function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('Cookie') ?? '';
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(cookie);
}

export function serverQueryFn<T>(
  request: Request,
  path: string,
): (context?: { signal?: AbortSignal }) => Promise<T> {
  return async (context) => {
    const body = await fetchApiJsonForRequestOrThrow(request, path, context?.signal);
    if (body === null) throw new Error(`SSR prefetch failed: ${path}`);
    return body as T;
  };
}

export async function serverProbe<T>(request: Request, path: string): Promise<T | null> {
  const body = await fetchApiJsonForRequest(request, path);
  return (body as T | null) ?? null;
}

export async function buildSsrLoaderData(
  request: Request,
  prefetch: (queryClient: QueryClient, request: Request) => Promise<void>,
): Promise<SsrLoaderData> {
  const queryClient = createQueryClient();
  if (hasSessionCookie(request)) {
    await prefetch(queryClient, request);
  }
  return { dehydratedState: dehydrate(queryClient) };
}
