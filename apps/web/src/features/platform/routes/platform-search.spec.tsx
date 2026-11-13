import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
import { baSessionResponse, isGetSessionUrl } from '#test/ba-session';
import { SearchPage } from '#features/platform/routes/platform-search';


const DOC = {
  id: 'doc-1',
  area: 'courses',
  itemId: 'course-1',
  title: 'Khoá Toán 10',
  content: 'Nội dung khoá toán',
};

const USER_DOC = {
  id: 'doc-2',
  area: 'users',
  itemId: 'user-1',
  title: 'Nguyễn Văn A',
  content: 'vana học viên',
};

const CONTENT_DOC = {
  id: 'doc-3',
  area: 'contentbank',
  itemId: 'item-1',
  title: 'Bài giảng Đại số',
  content: 'Học liệu đại số',
};

let searchCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SYSTEM_CONTEXT_ID = '01900000-0000-7000-8000-0000000000d4';
const STUDENT_VIEWER = {
  profile: {
    id: '01900000-0000-7000-8000-0000000000b2',
    username: 'student',
    firstName: 'Tên',
    lastName: 'Mẫu',
    email: 'student@example.com',
    suspended: false,
    deleted: false,
    isGuest: false,
    forcePasswordChange: false,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    customFields: [],
  },
  access: {
    userId: '01900000-0000-7000-8000-0000000000b2',
    isSiteAdmin: false,
    assignments: [],
    contexts: [],
    hasLearnerArtifacts: false,
  },
};
const USER_ADMIN_VIEWER = {
  profile: {
    ...STUDENT_VIEWER.profile,
    id: '01900000-0000-7000-8000-0000000000a1',
    username: 'usermanager',
    email: 'usermanager@example.com',
  },
  access: {
    userId: '01900000-0000-7000-8000-0000000000a1',
    isSiteAdmin: false,
    assignments: [],
    contexts: [
      {
        contextId: SYSTEM_CONTEXT_ID,
        contextLevel: 10,
        contextPath: '/1',
        capabilities: ['user:update'],
      },
    ],
    hasLearnerArtifacts: false,
  },
};

function stubFetch(docs: unknown[] = [DOC], viewer?: { profile: unknown; access: unknown }) {
  searchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (viewer && isGetSessionUrl(url)) {
        return baSessionResponse({ id: (viewer.profile as { id: string }).id });
      }
      if (viewer && url === '/api/v1/users/me') return jsonResponse(viewer.profile);
      if (viewer && url === '/api/v1/users/me/capabilities') return jsonResponse(viewer.access);
      if (viewer && url === '/api/v1/courses') return jsonResponse([]);
      if (url.startsWith('/api/v1/search?q=')) {
        searchCalls.push(url);
        return jsonResponse(docs);
      }
      return jsonResponse({}, 404);
    }),
  );
}

function renderSearch(initialPath = '/search') {
  const router = createMemoryRouter(
    [
      { path: 'search', element: <SearchPage /> },
      { path: 'courses/:id', element: <div data-testid="probe-target" /> },
      { path: 'admin/users/:userId/edit', element: <div data-testid="probe-target" /> },
      { path: 'content-bank/:id/edit', element: <div data-testid="probe-target" /> },
    ],
    { initialEntries: [initialPath] },
  );
  render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('trang kết quả tìm kiếm — đọc tham số q (issue #303)', () => {
  it('vào bằng /search?q=abc → ô điền sẵn abc và chạy tìm ngay', async () => {
    stubFetch();
    renderSearch('/search?q=abc');
    expect(screen.getByLabelText('Từ khoá tìm kiếm')).toHaveValue('abc');
    expect(await screen.findByText('Khoá Toán 10')).toBeInTheDocument();
    expect(searchCalls).toEqual(['/api/v1/search?q=abc']);
  });

  it('vào /search trần → không gọi API, ô trống', async () => {
    stubFetch();
    renderSearch('/search');
    expect(await screen.findByRole('button', { name: 'Tìm kiếm' })).toBeInTheDocument();
    expect(screen.getByLabelText('Từ khoá tìm kiếm')).toHaveValue('');
    expect(searchCalls).toEqual([]);
  });

  it('form trong trang giữ hành vi cũ: gõ + bấm Tìm kiếm chạy bằng từ khoá mới', async () => {
    stubFetch();
    renderSearch('/search');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Từ khoá tìm kiếm'), 'văn');
    await user.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(await screen.findByText('Khoá Toán 10')).toBeInTheDocument();
    expect(searchCalls).toEqual([`/api/v1/search?q=${encodeURIComponent('văn')}`]);
  });
});

describe('trang kết quả tìm kiếm — đổi URL thành từ khoá trắng', () => {
  it('xoá kết quả tìm cũ và không gọi API khi q chỉ có khoảng trắng', async () => {
    stubFetch();
    const router = renderSearch('/search?q=math');
    expect(await screen.findByText('Khoá Toán 10')).toBeInTheDocument();

    await act(async () => { await router.navigate('/search?q=%20%20'); });
    expect(screen.getByLabelText('Từ khoá tìm kiếm')).toHaveValue('  ');
    expect(screen.queryByText('Khoá Toán 10')).not.toBeInTheDocument();
    expect(screen.queryByText('Không tìm thấy kết quả')).not.toBeInTheDocument();
    expect(searchCalls).toEqual(['/api/v1/search?q=math']);
  });

  it('kết quả request cũ trả về muộn không hồi sinh danh sách đã xoá', async () => {
    let releaseOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
    searchCalls = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/v1/search?q=')) {
        searchCalls.push(url);
        return oldResponse;
      }
      return Promise.resolve(jsonResponse({}, 404));
    }));

    const router = renderSearch('/search?q=math');
    await act(async () => { await router.navigate('/search?q=%20%20'); });
    await act(async () => { releaseOld(jsonResponse([DOC])); });

    expect(screen.queryByText('Khoá Toán 10')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Từ khoá tìm kiếm')).toHaveValue('  ');
    expect(searchCalls).toEqual(['/api/v1/search?q=math']);
  });
});

describe('trang kết quả tìm kiếm — chốt trình tự các lượt tìm chồng nhau', () => {
  const SLOW_DOC = {
    id: 'doc-slow',
    area: 'courses',
    itemId: 'course-slow',
    title: 'Kết quả của lượt chậm',
    content: 'Nội dung lượt chậm',
  };
  const FAST_DOC = {
    id: 'doc-fast',
    area: 'courses',
    itemId: 'course-fast',
    title: 'Kết quả của lượt nhanh',
    content: 'Nội dung lượt nhanh',
  };

  it('lượt tìm cũ trả về sau không ghi đè kết quả của lượt mới nhất', async () => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    searchCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/v1/search?q=')) {
          searchCalls.push(url);
          if (url.includes(encodeURIComponent('chậm'))) {
            await slowGate;
            return jsonResponse([SLOW_DOC]);
          }
          return jsonResponse([FAST_DOC]);
        }
        return jsonResponse({}, 404);
      }),
    );
    renderSearch('/search');
    const user = userEvent.setup();
    const input = screen.getByLabelText('Từ khoá tìm kiếm');

    await user.type(input, 'chậm');
    await user.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    await user.clear(input);
    await user.type(input, 'nhanh');
    await user.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(await screen.findByText('Kết quả của lượt nhanh')).toBeInTheDocument();
    expect(searchCalls).toEqual([
      `/api/v1/search?q=${encodeURIComponent('chậm')}`,
      `/api/v1/search?q=${encodeURIComponent('nhanh')}`,
    ]);

    await act(async () => {
      releaseSlow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText('Kết quả của lượt chậm')).not.toBeInTheDocument();
    expect(screen.getByText('Kết quả của lượt nhanh')).toBeInTheDocument();
  });
});

describe('trang kết quả tìm kiếm — kết quả điều hướng được (chốt gộp 27/10/2026)', () => {
  it('bấm kết quả khoá học → tới /courses/:id', async () => {
    stubFetch([DOC]);
    const router = renderSearch('/search?q=toán');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('search-result-doc-1'));
    expect(router.state.location.pathname).toBe('/courses/course-1');
  });

  it('người tìm có quyền quản trị người dùng: bấm kết quả người dùng → tới /admin/users/:id/edit', async () => {
    stubFetch([USER_DOC], USER_ADMIN_VIEWER);
    const router = renderSearch('/search?q=văn');
    const user = userEvent.setup();
    const link = await screen.findByTestId('search-result-doc-2');
    expect(link).toHaveTextContent('Người dùng');
    await user.click(link);
    expect(router.state.location.pathname).toBe('/admin/users/user-1/edit');
  });

  it('người tìm không có quyền quản trị người dùng: kết quả người dùng hiện dạng thông tin, không liên kết tới màn quản trị', async () => {
    stubFetch([USER_DOC], STUDENT_VIEWER);
    renderSearch('/search?q=văn');
    expect(await screen.findByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('vana học viên')).toBeInTheDocument();
    expect(screen.queryByTestId('search-result-doc-2')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/users/user-1/edit"]')).toBeNull();
  });

  it('bấm kết quả học liệu → tới /content-bank/:id/edit', async () => {
    stubFetch([CONTENT_DOC]);
    const router = renderSearch('/search?q=đại');
    const user = userEvent.setup();
    const link = await screen.findByTestId('search-result-doc-3');
    expect(link).toHaveTextContent('Nội dung học liệu');
    await user.click(link);
    expect(router.state.location.pathname).toBe('/content-bank/item-1/edit');
  });
});
