import { useState, type ReactNode } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useMatches,
  useRouteError,
} from 'react-router';
import type { UserProfile } from '@giaokhoa/contracts';
import { userProfileSchema } from '@giaokhoa/contracts';
import { HydrationBoundary, QueryClientProvider, type DehydratedState } from '@tanstack/react-query';
import { AuthProvider } from '#lib/auth';
import { PermissionsProvider } from '#lib/permissions';
import { createQueryClient, queryClient } from '#lib/query-client';
import { SidebarDefaultOpenContext } from '#lib/sidebar-default-open';
import { fetchApiJson } from '#lib/server-api';
import { AppShellSkeleton } from '#components/app-shell-skeleton';
import '#config/i18n';
import '@giaokhoa/ui/globals.css';

function parseSidebarState(cookie: string): boolean {
  const match = cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return match ? match[1] === 'true' : true;
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<{ initialUser: UserProfile | null; sidebarDefaultOpen: boolean }> {
  const cookie = request.headers.get('Cookie') ?? '';
  const sidebarDefaultOpen = parseSidebarState(cookie);
  if (!/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(cookie)) return { initialUser: null, sidebarDefaultOpen };
  const body = await fetchApiJson('/api/v1/users/me', { Cookie: cookie });
  const parsed = userProfileSchema.safeParse(body);
  return { initialUser: parsed.success ? parsed.data : null, sidebarDefaultOpen };
}

export function meta(): { title: string }[] {
  return [{ title: 'Giáo khoa' }];
}

export function headers(): Record<string, string> {
  return { 'Cache-Control': 'private, no-cache' };
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function collectDehydratedState(matches: ReturnType<typeof useMatches>): DehydratedState | undefined {
  let state: DehydratedState | undefined;
  for (const match of matches) {
    const data = match.loaderData as { dehydratedState?: DehydratedState } | undefined;
    if (data?.dehydratedState) state = data.dehydratedState;
  }
  return state;
}

export default function App() {
  const loaderData = useLoaderData<typeof loader>() as
    | { initialUser: UserProfile | null; sidebarDefaultOpen?: boolean }
    | undefined;
  const initialUser = loaderData?.initialUser;
  const sidebarDefaultOpen =
    loaderData?.sidebarDefaultOpen ??
    (typeof document === 'undefined' ? true : parseSidebarState(document.cookie));
  const [requestQueryClient] = useState(() => (typeof window === 'undefined' ? createQueryClient() : null));
  const dehydratedState = collectDehydratedState(useMatches());
  return (
    <SidebarDefaultOpenContext.Provider value={sidebarDefaultOpen}>
      <QueryClientProvider client={requestQueryClient ?? queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <AuthProvider initialUser={initialUser}>
            <PermissionsProvider>
              <Outlet />
            </PermissionsProvider>
          </AuthProvider>
        </HydrationBoundary>
      </QueryClientProvider>
    </SidebarDefaultOpenContext.Provider>
  );
}

export function HydrateFallback() {
  return <AppShellSkeleton />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : 'Đã xảy ra lỗi không mong muốn.';
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Giáo khoa</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <a href="/" className="text-sm underline underline-offset-4">
        Về trang chủ
      </a>
    </main>
  );
}
