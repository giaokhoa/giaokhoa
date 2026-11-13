import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './root';
import Shell from './shell';
import routesConfig from './routes';
import { useAuth } from '#lib/auth';
import { usePermissions } from '#lib/permissions';
import { queryClient } from '#lib/query-client';
import { queryKeys } from '#lib/query-keys';
import { baNoSessionResponse, baSessionResponse, isGetSessionUrl } from '#test/ba-session';


const ADMIN_ID = '01900000-0000-7000-8000-0000000000a1';
const SAMPLE_ID = '01900000-0000-7000-8000-000000000001';

const PROFILE = {
  id: ADMIN_ID,
  username: 'admin',
  firstName: 'Quản',
  lastName: 'Trị',
  email: 'admin@example.com',
  suspended: false,
  deleted: false,
  isGuest: false,
  forcePasswordChange: false,
  lastLogin: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  customFields: [],
};

const ACCESS = { userId: ADMIN_ID, isSiteAdmin: true, assignments: [], contexts: [] };

function Probe({ pattern }: { pattern: string }) {
  const { user, logout } = useAuth();
  const perms = usePermissions();
  return (
    <div
      data-testid="route-probe"
      data-pattern={pattern}
      data-user={user?.username ?? ''}
      data-ready={String(perms.ready)}
      data-admin={String(perms.canAdminister)}
    >
      <button type="button" data-testid="probe-logout" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

interface RouteCase {
  pattern: string;
  url: string;
  route: { index: true } | { path: string };
}

const ROUTE_CASES: RouteCase[] = (() => {
  const layoutEntry = routesConfig[0] as unknown as {
    children: Array<{ path?: string; index?: boolean }>;
  };
  return layoutEntry.children.map((child) => {
    if (child.index) return { pattern: '/', url: '/', route: { index: true } as const };
    const path = child.path ?? '';
    return {
      pattern: `/${path}`,
      url: `/${path.replaceAll(':id', SAMPLE_ID)}`,
      route: { path },
    };
  });
})();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetchWithSlowSession() {
  const me = deferred<Response>();
  let signedIn = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (isGetSessionUrl(url)) {
        return signedIn
          ? baSessionResponse({ id: ADMIN_ID, username: 'admin', email: 'admin@example.com' })
          : baNoSessionResponse();
      }
      if (url === '/api/v1/users/me') return me.promise;
      if (String(url).endsWith('/api/v1/auth/sign-out')) {
        signedIn = false;
        return jsonResponse({ success: true });
      }
      if (url === '/api/v1/users/me/capabilities') return signedIn ? jsonResponse(ACCESS) : jsonResponse({}, 401);
      if (url === '/api/v1/courses') return signedIn ? jsonResponse([]) : jsonResponse({}, 401);
      return jsonResponse({}, 404);
    }),
  );
  return me;
}

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      {
        element: <App />,
        children: [
          {
            element: <Shell />,
            children: ROUTE_CASES.map((c) =>
              'index' in c.route
                ? { index: true, element: <Probe pattern={c.pattern} /> }
                : { path: c.route.path, element: <Probe pattern={c.pattern} /> },
            ),
          },
        ],
      },
    ],
    { initialEntries: [url] },
  );
  return render(<RouterProvider router={router} />);
}

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  queryClient.clear();
});

describe('cổng chờ phiên — vào thẳng/F5 từng route với phiên resolve chậm', () => {
  it.each(ROUTE_CASES)(
    'route $pattern: chưa mount trang con, không lóe khung công khai; resolve xong thì mount trong provider',
    async (routeCase) => {
      const me = stubFetchWithSlowSession();
      const { container } = renderAt(routeCase.url);

      expect(screen.queryByTestId('route-probe')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="app-shell-skeleton"]')).not.toBeNull();
      expect(screen.queryByRole('link', { name: /đăng nhập/i })).not.toBeInTheDocument();

      me.resolve(jsonResponse(PROFILE));

      const probe = await screen.findByTestId('route-probe');
      expect(probe.dataset.pattern).toBe(routeCase.pattern);
      expect(probe.dataset.user).toBe('admin');
      await waitFor(() => expect(probe.dataset.ready).toBe('true'));
      expect(probe.dataset.admin).toBe('true');
      expect(container.querySelector('[data-testid="app-shell-skeleton"]')).toBeNull();
    },
  );
});

describe('vào thẳng từng route khi phiên resolve ra CHƯA đăng nhập', () => {
  it.each(ROUTE_CASES)(
    'route $pattern: trang con vẫn mount trong provider ở root, usePermissions trả ảnh chụp rỗng thay vì ném lỗi',
    async (routeCase) => {
      const me = stubFetchWithSlowSession();
      renderAt(routeCase.url);

      expect(screen.queryByTestId('route-probe')).not.toBeInTheDocument();

      me.resolve(jsonResponse({ title: 'Unauthorized', status: 401 }, 401));

      const probe = await screen.findByTestId('route-probe');
      expect(probe.dataset.pattern).toBe(routeCase.pattern);
      expect(probe.dataset.user).toBe('');
      await waitFor(() => expect(probe.dataset.ready).toBe('true'));
      expect(probe.dataset.admin).toBe('false');
    },
  );
});

describe('dọn dẹp khi đăng xuất', () => {
  it('huỷ phiên cookie và dọn toàn bộ Query cache của phiên trước', async () => {
    const me = stubFetchWithSlowSession();
    renderAt('/courses');
    me.resolve(jsonResponse(PROFILE));

    const probe = await screen.findByTestId('route-probe');
    await waitFor(() => expect(probe.dataset.ready).toBe('true'));
    expect(queryClient.getQueryCache().findAll().length).toBeGreaterThan(0);
    expect(localStorage.getItem('giaokhoa.accessToken')).toBeNull();
    expect(localStorage.getItem('giaokhoa.refreshToken')).toBeNull();

    await userEvent.click(screen.getByTestId('probe-logout'));

    await waitFor(() => expect(screen.getByTestId('route-probe').dataset.admin).toBe('false'));
    expect(screen.getByTestId('route-probe').dataset.user).toBe('');
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.capabilities)).toBeFalsy());
    expect(queryClient.getQueryData(queryKeys.courses)).toBeFalsy();
  });
});
