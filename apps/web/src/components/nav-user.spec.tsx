import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../app/root';
import Shell from '../app/shell';
import { queryClient } from '#lib/query-client';
import { baSessionResponse, isGetSessionUrl } from '#test/ba-session';


const ADMIN_ID = '01900000-0000-7000-8000-0000000000a1';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (isGetSessionUrl(url)) return baSessionResponse({ id: ADMIN_ID, username: 'admin', email: 'admin@example.com' });
      if (url === '/api/v1/users/me') return jsonResponse(PROFILE);
      if (url === '/api/v1/users/me/capabilities') return jsonResponse(ACCESS);
      if (url === '/api/v1/courses') return jsonResponse([]);
      return jsonResponse({}, 404);
    }),
  );
}

function renderShell() {
  const router = createMemoryRouter(
    [
      {
        element: <App />,
        children: [
          {
            element: <Shell />,
            children: [{ index: true, element: <div data-testid="home-probe" /> }],
          },
        ],
      },
    ],
    { initialEntries: ['/'] },
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  queryClient.clear();
});

describe('menu tài khoản ở chân sidebar', () => {
  it('bấm mở menu: hiện mục Hồ sơ và Đăng xuất, không sập màn hình', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderShell();

    const trigger = await screen.findByRole('button', { name: /Quản Trị/ });
    await user.click(trigger);

    expect(await screen.findByRole('menuitem', { name: /Hồ sơ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Đăng xuất/ })).toBeInTheDocument();
    expect(screen.getByTestId('home-probe')).toBeInTheDocument();
  });
});
