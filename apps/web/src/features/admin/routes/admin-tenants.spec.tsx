import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
import { baSessionResponse, isGetSessionUrl } from '#test/ba-session';
import { AdminTenantsPage } from './admin-tenants';


const ME_ID = '01900000-0000-7000-8000-0000000000d1';
const SYS_CTX_ID = '01900000-0000-7000-8000-0000000000e1';
const TENANT_CTX_ID = '01900000-0000-7000-8000-0000000000e2';
const TENANT_A_ID = '01900000-0000-7000-8000-0000000000a1';
const TENANT_B_ID = '01900000-0000-7000-8000-0000000000b1';
const MEMBER_A_ID = '01900000-0000-7000-8000-0000000000c1';
const MEMBER_B_ID = '01900000-0000-7000-8000-0000000000c2';
const NEW_USER_ID = '01900000-0000-7000-8000-0000000000c3';

const TENANT_A = {
  id: TENANT_A_ID,
  slug: 'trung-tam-alpha',
  name: 'Trung tâm Alpha',
  kind: 'center',
  status: 'active',
  plan: 'pro',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
};
const TENANT_B = {
  id: TENANT_B_ID,
  slug: 'trung-tam-beta',
  name: 'Trung tâm Beta',
  kind: 'center',
  status: 'active',
  plan: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
};


const PROFILE = {
  id: ME_ID,
  username: 'me1',
  firstName: 'Người',
  lastName: 'Dùng',
  email: 'me@example.com',
  suspended: false,
  deleted: false,
  isGuest: false,
  forcePasswordChange: false,
  lastLogin: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  customFields: [],
};

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

interface AccessOptions {
  systemCaps?: string[];
  tenantCaps?: string[] | null;
  capsTenantId?: string;
}

function accessView({ systemCaps = [], tenantCaps = null, capsTenantId = TENANT_A_ID }: AccessOptions) {
  const contexts = [
    { contextId: SYS_CTX_ID, contextLevel: 10, contextPath: '/1', capabilities: systemCaps },
  ];
  const assignments = [];
  if (tenantCaps) {
    contexts.push({ contextId: TENANT_CTX_ID, contextLevel: 20, contextPath: '/1/2', capabilities: tenantCaps });
    assignments.push({
      id: '01900000-0000-7000-8000-0000000000f1',
      roleId: '01900000-0000-7000-8000-0000000000b9',
      roleShortname: 'manager',
      roleName: 'Chủ trung tâm',
      contextId: TENANT_CTX_ID,
      contextLevel: 20,
      contextPath: '/1/2',
      instanceId: capsTenantId,
    });
  }
  return { userId: ME_ID, isSiteAdmin: false, assignments, contexts, hasLearnerArtifacts: false };
}

interface StubOptions extends AccessOptions {
  failAddMember?: boolean;
  currentTenantStatus?: string;
}

function stubFetch(calls: RecordedCall[], options: StubOptions) {
  const tenants = [TENANT_A, TENANT_B];
  let membersA = [
    { id: 'membership-a1', tenantId: TENANT_A_ID, userId: MEMBER_A_ID, status: 'active', joinedAt: '2026-09-03T00:00:00.000Z', endedAt: null },
  ];
  const usersA = [
    { id: MEMBER_A_ID, username: 'membera', firstName: 'An', lastName: 'Nguyễn', email: 'a@example.com', suspended: false, deleted: false },
    { id: MEMBER_B_ID, username: 'memberb', firstName: 'Bình', lastName: 'Trần', email: 'b@example.com', suspended: false, deleted: false },
  ];
  const membersB = [
    { id: 'membership-b1', tenantId: TENANT_B_ID, userId: MEMBER_B_ID, status: 'suspended', joinedAt: '2026-09-04T00:00:00.000Z', endedAt: null },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (!isGetSessionUrl(url)) calls.push({ url, method, body });
      const respond = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
      if (isGetSessionUrl(url)) return baSessionResponse({ id: ME_ID, username: 'me1', email: 'me@example.com' });
      if (url === '/api/v1/users/me') return respond(PROFILE);
      if (url === '/api/v1/users/me/capabilities') return respond(accessView(options));
      if (url === '/api/v1/courses') return respond([]);
      if (url === '/api/v1/tenants' && method === 'GET') return respond(tenants);
      if (url === '/api/v1/tenants/current')
        return respond({ ...TENANT_A, status: options.currentTenantStatus ?? TENANT_A.status });
      if (url === `/api/v1/tenants/${TENANT_A_ID}/members` && method === 'GET') return respond(membersA);
      if (url === `/api/v1/tenants/${TENANT_B_ID}/members` && method === 'GET') return respond(membersB);
      if (url === `/api/v1/tenants/${TENANT_A_ID}/users` && method === 'GET') return respond(usersA);
      if (url === `/api/v1/tenants/${TENANT_B_ID}/users` && method === 'GET') return respond([usersA[1]]);
      if (url === `/api/v1/tenants/${TENANT_A_ID}/members` && method === 'POST') {
        if (options.failAddMember) return respond({ title: 'Forbidden', status: 403 }, 403);
        const membership = {
          id: 'membership-a2',
          tenantId: TENANT_A_ID,
          userId: body.userId,
          status: 'active',
          joinedAt: '2026-10-01T00:00:00.000Z',
          endedAt: null,
        };
        membersA = [...membersA, membership];
        return respond(membership, 201);
      }
      if (url === `/api/v1/tenants/${TENANT_A_ID}/users` && method === 'POST') {
        return respond(
          { id: NEW_USER_ID, username: body.username, firstName: '', lastName: '', email: body.email, suspended: false, deleted: false },
          201,
        );
      }
      const patchMatch = url.match(new RegExp(`^/api/v1/tenants/${TENANT_A_ID}/members/(.+)$`));
      if (patchMatch && method === 'PATCH') {
        membersA = membersA.map((m) => (m.userId === patchMatch[1] ? { ...m, status: body.status } : m));
        return respond(membersA.find((m) => m.userId === patchMatch[1]));
      }
      return respond({}, 404);
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/admin/tenants', element: <AdminTenantsPage /> }], {
    initialEntries: ['/admin/tenants'],
  });
  render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
}

describe('Trang quản trị tenant', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('platform manager: thấy các trung tâm, hướng dẫn cấp kho riêng và không có form shared', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { systemCaps: ['tenant:manage'] });
    renderPage();

    expect(await screen.findByText('Trung tâm Alpha')).toBeInTheDocument();
    expect(screen.getByText('Trung tâm Beta')).toBeInTheDocument();
    expect(await screen.findByText('membera')).toBeInTheDocument();
    expect(screen.queryByText('memberb')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Trung tâm Beta/ }));
    expect(await screen.findByText('memberb')).toBeInTheDocument();
    expect(screen.queryByText('membera')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url === `/api/v1/tenants/${TENANT_B_ID}/members` && c.method === 'GET')).toBe(true);

    expect(screen.getByText(/Mọi trung tâm và trường học mới đều phải được vận hành cấp database/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo trường học' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tên trung tâm')).not.toBeInTheDocument();
    expect(calls.some((call) => call.url === '/api/v1/tenants' && call.method === 'POST')).toBe(false);
  });

  it('platform viewer: xem được danh sách và thành viên nhưng không có điều khiển ghi nào', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { systemCaps: ['tenant:viewall'] });
    renderPage();

    expect(await screen.findByText('Trung tâm Alpha')).toBeInTheDocument();
    expect(await screen.findByText('membera')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tên trung tâm')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo trường học' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm thành viên' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạm dừng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kết thúc' })).not.toBeInTheDocument();
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('chủ trung tâm: không nạp danh sách platform, quản lý được membership của tenant mình', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { tenantCaps: ['tenant:manage'] });
    renderPage();

    expect(await screen.findByText('Trung tâm Alpha')).toBeInTheDocument();
    const tenantCard = screen.getByText('Trung tâm Alpha').closest('div');
    expect(tenantCard).not.toBeNull();
    expect(within(tenantCard!).getByText('Đang hoạt động')).toBeInTheDocument();
    expect(await screen.findByText('membera')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/v1/tenants')).toBe(false);
    expect(calls.some((c) => c.url === '/api/v1/tenants/current')).toBe(true);
    expect(screen.queryByText('Trung tâm Beta')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('ID người dùng'), MEMBER_B_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm thành viên' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/members` && c.method === 'POST')).toBe(true),
    );
    const addPost = calls.find((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/members` && c.method === 'POST');
    expect(addPost?.body).toEqual({ userId: MEMBER_B_ID });
    expect(await screen.findByText('Đã thêm thành viên vào trung tâm.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Tên đăng nhập'), 'newuser1');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo người dùng' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/users` && c.method === 'POST')).toBe(true),
    );
    const createPost = calls.find((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/users` && c.method === 'POST');
    expect(createPost?.body).toMatchObject({ username: 'newuser1', email: 'new@example.com', password: 'secret-password' });
    expect(await screen.findByText('Đã tạo người dùng và thêm vào trung tâm.')).toBeInTheDocument();

    const memberRow = screen.getByText('membera').closest('tr');
    expect(memberRow).not.toBeNull();
    await userEvent.click(within(memberRow!).getByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/members/${MEMBER_A_ID}` && c.method === 'PATCH'),
      ).toBe(true),
    );
    const patch = calls.find((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/members/${MEMBER_A_ID}`);
    expect(patch?.body).toEqual({ status: 'suspended' });
    expect(await screen.findByText('Đã đổi trạng thái thành viên.')).toBeInTheDocument();
  });

  it('vai trò xem phía tenant: xem được tenant và thành viên của mình, không có điều khiển ghi', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { tenantCaps: ['tenant:viewall'] });
    renderPage();

    expect(await screen.findByText('Trung tâm Alpha')).toBeInTheDocument();
    expect(await screen.findByText('membera')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm thành viên' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạm dừng' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tên đăng nhập')).not.toBeInTheDocument();
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('tenant hiệu lực đang tạm dừng: huy hiệu của thẻ tenant hiện "Đã tạm dừng" theo status', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { tenantCaps: ['tenant:viewall'], currentTenantStatus: 'suspended' });
    renderPage();

    const tenantCard = (await screen.findByText('Trung tâm Alpha')).closest('div');
    expect(tenantCard).not.toBeNull();
    expect(within(tenantCard!).getByText('Đã tạm dừng')).toBeInTheDocument();
    expect(within(tenantCard!).queryByText('Đang hoạt động')).not.toBeInTheDocument();
  });

  it('quyền tenant chỉ ở tenant khác: khu thành viên hiện trạng thái cấm thay vì treo khung chờ', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { tenantCaps: ['tenant:viewall'], capsTenantId: TENANT_B_ID });
    renderPage();

    expect(await screen.findByText('Trung tâm Alpha')).toBeInTheDocument();
    expect(
      await screen.findByText('Bạn không có capability quản trị tenant cho phạm vi này.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('membera')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/members`)).toBe(false);
    expect(calls.some((c) => c.url === `/api/v1/tenants/${TENANT_A_ID}/users`)).toBe(false);
  });

  it('giáo viên thường: chỉ thấy trạng thái không có quyền và trang không gọi endpoint tenant nào', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { systemCaps: ['question:add'] });
    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('Bạn không có capability quản trị tenant cho phạm vi này.')).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    expect(screen.queryByText('Trung tâm Alpha')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/v1/tenants'))).toBe(false);
  });

  it('thao tác ghi bị API trả 403: hiện lỗi và không đổi trạng thái hiển thị thành công giả', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { tenantCaps: ['tenant:manage'], failAddMember: true });
    renderPage();

    expect(await screen.findByText('membera')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('ID người dùng'), MEMBER_B_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm thành viên' }));

    expect(
      await screen.findByText('Không thể thêm thành viên (lỗi quyền, tenant không hoạt động hoặc người dùng không tồn tại).'),
    ).toBeInTheDocument();
    expect(screen.queryByText('memberb')).not.toBeInTheDocument();
    expect(screen.getAllByText('Đang hoạt động').length).toBeGreaterThan(0);
  });
});
