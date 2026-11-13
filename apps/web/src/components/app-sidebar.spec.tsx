import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../app/root';
import Shell from '../app/shell';
import { queryClient } from '#lib/query-client';
import { baSessionResponse, isGetSessionUrl } from '#test/ba-session';


const ADMIN_ID = '01900000-0000-7000-8000-0000000000a1';
const STUDENT_ID = '01900000-0000-7000-8000-0000000000b2';
const TEACHER_ID = '01900000-0000-7000-8000-0000000000c3';
const SYSTEM_CONTEXT_ID = '01900000-0000-7000-8000-0000000000d4';

function profileOf(id: string, username: string) {
  return {
    id,
    username,
    firstName: 'Tên',
    lastName: 'Mẫu',
    email: `${username}@example.com`,
    suspended: false,
    deleted: false,
    isGuest: false,
    forcePasswordChange: false,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    customFields: [],
  };
}

const ADMIN_ACCESS = { userId: ADMIN_ID, isSiteAdmin: true, assignments: [], contexts: [], hasLearnerArtifacts: true };
const STUDENT_ACCESS = { userId: STUDENT_ID, isSiteAdmin: false, assignments: [], contexts: [], hasLearnerArtifacts: true };
const TEACHER_ACCESS = {
  userId: TEACHER_ID,
  isSiteAdmin: false,
  assignments: [],
  contexts: [
    {
      contextId: SYSTEM_CONTEXT_ID,
      contextLevel: 10,
      contextPath: '/1',
      capabilities: ['question:add'],
    },
  ],
  hasLearnerArtifacts: true,
};

const COURSE_CONTEXT_ID = '01900000-0000-7000-8000-0000000000e5';
const COURSE_ID = '01900000-0000-7000-8000-0000000000f6';
const COURSE_CATEGORY_ID = '01900000-0000-7000-8000-0000000000a7';
const COURSE = { id: COURSE_ID, category: COURSE_CATEGORY_ID, fullName: 'Toán 6', shortName: 'TOAN6' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(
  profile: unknown,
  access: unknown,
  unread = 0,
  opts: { courses?: unknown[]; guardianChildren?: unknown[] } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (isGetSessionUrl(url)) return baSessionResponse({ id: (profile as { id: string }).id });
      if (url === '/api/v1/users/me') return jsonResponse(profile);
      if (url === '/api/v1/users/me/capabilities') return jsonResponse(access);
      if (url === '/api/v1/courses') return jsonResponse(opts.courses ?? []);
      if (url === '/api/v1/guardian-links/mine/students') {
        return opts.guardianChildren ? jsonResponse(opts.guardianChildren) : jsonResponse({}, 404);
      }
      if (url === '/api/v1/notifications/unread-count') return jsonResponse({ unread });
      if (url === '/api/v1/auth/refresh') return jsonResponse({}, 401);
      return jsonResponse({}, 404);
    }),
  );
}

const PROBE_PATHS = [
  'courses',
  'calendar',
  'messages',
  'notifications',
  'search',
  'badges',
  'learning-plan',
  'questions',
  'questions/stimuli',
  'exams',
  'matrices',
  'system-bank/questions',
  'system-bank/exams',
  'system-bank/matrices',
  'admin/users',
  'admin/roles',
  'tokens',
  'admin/site-config',
  'reports',
  'insights',
  'content-bank',
  'backup',
  'privacy',
  'health',
];

function renderShell(initialPath = '/') {
  const router = createMemoryRouter(
    [
      {
        element: <App />,
        children: [
          {
            element: <Shell />,
            children: [
              { index: true, element: <div data-testid="probe-index" /> },
              ...PROBE_PATHS.map((path) => ({
                path,
                element: <div data-testid={`probe-${path.replaceAll('/', '-')}`} />,
              })),
            ],
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
}

function sidebarRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector('[data-slot="sidebar"]');
  if (!root) throw new Error('không thấy sidebar');
  return root as HTMLElement;
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
  document.cookie = 'sidebar_state=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  queryClient.clear();
});

describe('cây điều hướng sidebar — admin', () => {
  it('thấy 5 mục trực tiếp + 3 mục cha; nhóm đóng mặc định nên chưa thấy mục con', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS, 2);
    renderShell();

    for (const name of ['Tổng quan', 'Khoá học', 'Lịch', 'Tin nhắn', 'Thông báo']) {
      expect(await screen.findByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: /Tìm kiếm/ })).not.toBeInTheDocument();
    const notifications = await screen.findByRole('link', { name: /Thông báo/ });
    expect(await within(notifications).findByText('2')).toBeInTheDocument();

    for (const name of ['Học tập', 'Người dùng & quyền', 'Vai trò & Quyền', 'Cài đặt hệ thống']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    for (const name of ['Ngân hàng câu hỏi', 'Ngân hàng đề', 'Ngân hàng ma trận']) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Ngân hàng câu hỏi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ngân hàng hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ngân hàng hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sao lưu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vai trò' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Huy hiệu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ngữ liệu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Câu hỏi hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Đề hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ma trận hệ thống' })).not.toBeInTheDocument();
  });

  it('mở thu/mở của "Ngân hàng câu hỏi" thấy mục con "Ngữ liệu" đúng href theo path riêng (chuẩn #221)', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' })).toHaveAttribute('href', '/questions');
    expect(screen.queryByRole('link', { name: 'Ngữ liệu' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thu/mở Ngân hàng câu hỏi' }));
    expect(await screen.findByRole('link', { name: 'Ngữ liệu' })).toHaveAttribute('href', '/questions/stimuli');
  });

  it('chevron của "Ngân hàng câu hỏi" nằm trong cùng bề mặt nút với nhãn; nhóm chưa có mục con không có nút thu/mở', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    renderShell();

    const label = await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' });
    const toggle = screen.getByRole('button', { name: 'Thu/mở Ngân hàng câu hỏi' });
    const item = label.closest('li[data-sidebar="menu-item"]');
    expect(item).not.toBeNull();
    expect(item!.contains(toggle)).toBe(true);
    expect(toggle.className).not.toMatch(/\bh-8\b/);
    expect(toggle.className).not.toMatch(/\bw-8\b/);
    expect(screen.queryByRole('button', { name: 'Thu/mở Ngân hàng đề' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thu/mở Ngân hàng ma trận' })).not.toBeInTheDocument();
  });

  it('bấm thân "Ngân hàng câu hỏi" điều hướng tới trang /questions', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    renderShell();

    await userEvent.click(await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' }));
    expect(await screen.findByTestId('probe-questions')).toBeInTheDocument();
  });

  it('sidebar không còn đường nào tới khu hệ thống — khu hệ thống chỉ vào bằng tab trong trang danh sách', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    const { container } = renderShell();

    expect(await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' })).toBeInTheDocument();
    const sidebar = sidebarRoot(container);
    expect(sidebar.querySelector('a[href^="/system-bank"]')).toBeNull();
    expect(within(sidebar).queryByText('Ngân hàng hệ thống')).not.toBeInTheDocument();
  });

  it('mở "Cài đặt hệ thống" thấy đủ 7 mục con đúng thứ tự; các nhóm mở độc lập và đóng riêng được', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Cài đặt hệ thống' }));

    const expectedOrder = [
      '/admin/site-config',
      '/reports',
      '/insights',
      '/content-bank',
      '/backup',
      '/privacy',
      '/health',
    ];
    const hrefs: string[] = [];
    for (const name of [
      'Cấu hình site',
      'Báo cáo',
      'Nhận định',
      'Ngân hàng nội dung',
      'Sao lưu',
      'Quyền riêng tư',
      'Trạng thái hệ thống',
    ]) {
      const link = await screen.findByRole('link', { name });
      hrefs.push(link.getAttribute('href')!);
    }
    expect(hrefs).toEqual(expectedOrder);

    await userEvent.click(screen.getByRole('button', { name: 'Vai trò & Quyền' }));
    expect(await screen.findByRole('link', { name: 'Vai trò' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sao lưu' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cài đặt hệ thống' }));
    expect(screen.queryByRole('link', { name: 'Sao lưu' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vai trò' })).toBeInTheDocument();
  });

  it('bấm mục con điều hướng tới đúng trang', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Cài đặt hệ thống' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Sao lưu' }));
    expect(await screen.findByTestId('probe-backup')).toBeInTheDocument();
  });
});

describe('cây điều hướng sidebar — trạng thái nhóm', () => {
  it('lưu nhóm đang mở vào localStorage và giữ nguyên sau khi dựng lại cây (F5)', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    const first = renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Học tập' }));
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('giaokhoa:sidebar:open-groups') ?? '[]')).toEqual(['learning']);

    first.unmount();
    renderShell();
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sao lưu' })).not.toBeInTheDocument();
  });

  it('nhóm chứa route đang xem luôn tự mở; mục con và nút cha cùng mang trạng thái active', async () => {
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    renderShell('/admin/roles');

    const child = await screen.findByRole('link', { name: 'Vai trò' });
    expect(child).toHaveAttribute('href', '/admin/roles');
    expect(child.hasAttribute('data-active')).toBe(true);
    const parent = screen.getByRole('button', { name: 'Vai trò & Quyền' });
    expect(parent.hasAttribute('data-active')).toBe(true);
  });

  it('đang ở /exams: mục top level "Ngân hàng đề" là link active, hai mục ngân hàng còn lại không', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), TEACHER_ACCESS);
    renderShell('/exams');

    const child = await screen.findByRole('link', { name: 'Ngân hàng đề' });
    expect(child).toHaveAttribute('href', '/exams');
    expect(child.hasAttribute('data-active')).toBe(true);
    expect(screen.getByRole('link', { name: 'Ngân hàng câu hỏi' }).hasAttribute('data-active')).toBe(false);
    expect(screen.getByRole('link', { name: 'Ngân hàng ma trận' }).hasAttribute('data-active')).toBe(false);
  });

  it('đang ở /system-bank/exams: sidebar không có mục hệ thống nào; ba mục ngân hàng hiện đúng tên và không mục nào active lây', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), TEACHER_ACCESS);
    renderShell('/system-bank/exams');

    expect(await screen.findByRole('link', { name: 'Ngân hàng đề' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ngân hàng hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Đề hệ thống' })).not.toBeInTheDocument();
    for (const name of ['Ngân hàng câu hỏi', 'Ngân hàng đề', 'Ngân hàng ma trận']) {
      expect(screen.getByRole('link', { name }).hasAttribute('data-active')).toBe(false);
    }
  });

  it('đang ở /questions: "Ngân hàng câu hỏi" active và collapse tự mở thấy "Ngữ liệu" chưa active', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), TEACHER_ACCESS);
    renderShell('/questions');

    const parent = await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' });
    expect(parent.hasAttribute('data-active')).toBe(true);
    const child = await screen.findByRole('link', { name: 'Ngữ liệu' });
    expect(child).toHaveAttribute('href', '/questions/stimuli');
    expect(child.hasAttribute('data-active')).toBe(false);
  });

  it('đang ở /questions/stimuli: cả mục cha "Ngân hàng câu hỏi" lẫn mục con "Ngữ liệu" cùng active', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), TEACHER_ACCESS);
    renderShell('/questions/stimuli');

    const parent = await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' });
    expect(parent.hasAttribute('data-active')).toBe(true);
    const child = await screen.findByRole('link', { name: 'Ngữ liệu' });
    expect(child).toHaveAttribute('href', '/questions/stimuli');
    expect(child.hasAttribute('data-active')).toBe(true);
  });
});

describe('cây điều hướng sidebar — lọc theo quyền', () => {
  it('học viên: không thấy hai nhóm quản trị và không thấy mục ngân hàng nào', async () => {
    stubFetch(profileOf(STUDENT_ID, 'student1'), STUDENT_ACCESS);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Tổng quan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Người dùng & quyền' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cài đặt hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ngân hàng hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ngân hàng câu hỏi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ngân hàng đề' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ngân hàng ma trận' })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Học tập' }));
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kế hoạch học tập' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ngữ liệu' })).not.toBeInTheDocument();
  });

  it('giáo viên có capability câu hỏi: 3 mục ngân hàng ở cấp cao nhất, đúng href path riêng từng khu vực (chuẩn #221)', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), TEACHER_ACCESS);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Ngân hàng câu hỏi' })).toHaveAttribute('href', '/questions');
    expect(screen.getByRole('link', { name: 'Ngân hàng đề' })).toHaveAttribute('href', '/exams');
    expect(screen.getByRole('link', { name: 'Ngân hàng ma trận' })).toHaveAttribute('href', '/matrices');
    expect(screen.queryByRole('link', { name: 'Ngữ liệu' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thu/mở Ngân hàng câu hỏi' }));
    expect(await screen.findByRole('link', { name: 'Ngữ liệu' })).toHaveAttribute('href', '/questions/stimuli');
    expect(screen.queryByRole('button', { name: 'Ngân hàng hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Câu hỏi hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Đề hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ma trận hệ thống' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Người dùng & quyền' })).not.toBeInTheDocument();
  });

  it('chủ trung tâm không có quyền quản trị site: nhóm Người dùng & quyền chỉ chứa mục Trung tâm', async () => {
    const tenantOwnerAccess = {
      userId: TEACHER_ID,
      isSiteAdmin: false,
      assignments: [
        {
          id: '01900000-0000-7000-8000-0000000000f9',
          roleId: '01900000-0000-7000-8000-0000000000b9',
          roleShortname: 'manager',
          roleName: 'Chủ trung tâm',
          contextId: '01900000-0000-7000-8000-0000000000e9',
          contextLevel: 20,
          contextPath: '/1/2',
          instanceId: '01900000-0000-7000-8000-0000000000a9',
        },
      ],
      contexts: [
        { contextId: SYSTEM_CONTEXT_ID, contextLevel: 10, contextPath: '/1', capabilities: [] as string[] },
        {
          contextId: '01900000-0000-7000-8000-0000000000e9',
          contextLevel: 20,
          contextPath: '/1/2',
          capabilities: ['tenant:manage'],
        },
      ],
      hasLearnerArtifacts: true,
    };
    stubFetch(profileOf(TEACHER_ID, 'owner1'), tenantOwnerAccess);
    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Người dùng & quyền' }, { timeout: 10000 }));
    expect(await screen.findByRole('link', { name: 'Trung tâm' })).toHaveAttribute('href', '/admin/tenants');
    expect(screen.queryByRole('link', { name: 'Người dùng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vai trò' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cài đặt hệ thống' })).not.toBeInTheDocument();
  });
});

describe('cây điều hướng sidebar — chế độ rail icon', () => {
  it('cookie sidebar_state=false → rail icon có SidebarRail; bấm mục cha bung sidebar và mở nhóm', async () => {
    document.cookie = 'sidebar_state=false; path=/';
    stubFetch(profileOf(ADMIN_ID, 'admin'), ADMIN_ACCESS);
    const { container } = renderShell();

    const parentButton = await screen.findByRole('button', { name: 'Học tập' });
    const root = sidebarRoot(container);
    expect(root).toHaveAttribute('data-state', 'collapsed');
    expect(root).toHaveAttribute('data-collapsible', 'icon');
    expect(container.querySelector('[data-slot="sidebar-rail"]')).not.toBeNull();

    await userEvent.click(parentButton);
    expect(sidebarRoot(container)).toHaveAttribute('data-state', 'expanded');
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
  });
});

describe('nhóm Học tập theo dấu chân (issue #176, quy tắc M+A)', () => {
  const TEACHER_PURE = { ...TEACHER_ACCESS, hasLearnerArtifacts: false };
  const NO_FOOTPRINT = { userId: STUDENT_ID, isSiteAdmin: false, assignments: [], contexts: [], hasLearnerArtifacts: false };
  const LEARNER_ACCESS = {
    userId: STUDENT_ID,
    isSiteAdmin: false,
    assignments: [
      {
        id: '01900000-0000-7000-8000-0000000000b8',
        roleId: '01900000-0000-7000-8000-0000000000b9',
        roleShortname: 'student',
        roleName: 'Học viên',
        contextId: COURSE_CONTEXT_ID,
        contextLevel: 50,
        contextPath: `/1/${COURSE_CONTEXT_ID}`,
        instanceId: COURSE_ID,
      },
    ],
    contexts: [
      {
        contextId: COURSE_CONTEXT_ID,
        contextLevel: 50,
        contextPath: `/1/${COURSE_CONTEXT_ID}`,
        capabilities: ['course:view'],
      },
    ],
    hasLearnerArtifacts: false,
  };

  it('1. GV thuần (dạy, không học ở đâu, không hiện vật): không có nút nhóm Học tập', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), TEACHER_PURE);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Tổng quan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Học tập' })).not.toBeInTheDocument();
  });

  it('2. GV có ghi danh học viên ở khoá khác: nhóm hiện, mở ra thấy Huy hiệu + Kế hoạch học tập', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), { ...LEARNER_ACCESS, userId: TEACHER_ID }, 0, { courses: [COURSE] });
    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Học tập' }));
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kế hoạch học tập' })).toBeInTheDocument();
  });

  it('3. HS (ghi danh học viên): nhóm hiện như hiện tại', async () => {
    stubFetch(profileOf(STUDENT_ID, 'student1'), LEARNER_ACCESS, 0, { courses: [COURSE] });
    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Học tập' }));
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kế hoạch học tập' })).toBeInTheDocument();
  });

  it('4. Hết ghi danh nhưng còn hiện vật: nhóm vẫn hiện', async () => {
    stubFetch(profileOf(STUDENT_ID, 'student1'), STUDENT_ACCESS);
    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: 'Học tập' }));
    expect(await screen.findByRole('link', { name: 'Huy hiệu' })).toBeInTheDocument();
  });

  it('5. Tài khoản mới (mọi tín hiệu rỗng): nhóm ẩn nhưng mục trực tiếp Khoá học vẫn hiện', async () => {
    stubFetch(profileOf(STUDENT_ID, 'newuser'), NO_FOOTPRINT);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Khoá học' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Học tập' })).not.toBeInTheDocument();
  });

  it('6. Phụ huynh thuần (có liên kết giám hộ, không dấu chân): nhóm ẩn, mục Phụ huynh hiện', async () => {
    stubFetch(profileOf(STUDENT_ID, 'parent1'), NO_FOOTPRINT, 0, {
      guardianChildren: [{ student: { id: '01900000-0000-7000-8000-0000000000c0' } }],
    });
    renderShell();

    expect(await screen.findByRole('link', { name: 'Phụ huynh' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Học tập' })).not.toBeInTheDocument();
  });
});

describe('mục quản lý liên kết phụ huynh — gác theo guardian:manage (gói kích hoạt phụ huynh)', () => {
  const GUARDIAN_MANAGER_ACCESS = {
    userId: TEACHER_ID,
    isSiteAdmin: false,
    assignments: [],
    contexts: [
      {
        contextId: '01900000-0000-7000-8000-0000000000d5',
        contextLevel: 30,
        contextPath: '/1/2',
        capabilities: ['guardian:manage'],
      },
    ],
    hasLearnerArtifacts: false,
  };

  it('người có guardian:manage thấy mục Liên kết phụ huynh dẫn tới trang quản lý', async () => {
    stubFetch(profileOf(TEACHER_ID, 'teacher1'), GUARDIAN_MANAGER_ACCESS);
    renderShell();

    const link = await screen.findByRole('link', { name: 'Liên kết phụ huynh' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/admin/guardian-links');
  });

  it('học viên không có guardian:manage thì không thấy mục Liên kết phụ huynh', async () => {
    stubFetch(profileOf(STUDENT_ID, 'student1'), STUDENT_ACCESS);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Khoá học' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Liên kết phụ huynh' })).not.toBeInTheDocument();
  });
});
