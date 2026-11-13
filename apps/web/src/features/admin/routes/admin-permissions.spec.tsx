import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
import { AdminPermissionsPage } from './admin-permissions';

const ROLE_A_ID = '01900000-0000-7000-8000-0000000000b1';
const ROLE_B_ID = '01900000-0000-7000-8000-0000000000b2';
const SYSTEM_CONTEXT_ID = '01900000-0000-7000-8000-000000000010';
const TENANT_CONTEXT_ID = '01900000-0000-7000-8000-000000000020';

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

interface StubOptions {
  matrixBehavior?: 'pending';
  postError?: boolean;
  onPostDeferred?: (controls: {
    resolvePost: () => void;
    rejectPost: (reason?: unknown) => void;
  }) => void;
  afterPostApply?: (store: Record<string, Record<string, Record<string, number>>>) => void;
}

function initialStore(): Record<string, Record<string, Record<string, number>>> {
  return {
    [SYSTEM_CONTEXT_ID]: {
      [ROLE_A_ID]: { 'course:view': 1 },
      [ROLE_B_ID]: { 'user:view': -1000 },
    },
    [TENANT_CONTEXT_ID]: {
      [ROLE_A_ID]: { 'course:edit': 1, 'user:view': -1 },
      [ROLE_B_ID]: { 'course:view': 1 },
    },
  };
}

function stubFetch(calls: RecordedCall[], options: StubOptions = {}) {
  const store = initialStore();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const respond = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/v1/access/capabilities')
        return respond([
          { id: '01900000-0000-7000-8000-0000000000c1', name: 'course:view', capType: 'read', contextLevel: 50, component: 'core' },
          { id: '01900000-0000-7000-8000-0000000000c2', name: 'course:edit', capType: 'write', contextLevel: 50, component: 'core' },
          { id: '01900000-0000-7000-8000-0000000000c3', name: 'user:view', capType: 'read', contextLevel: 30, component: 'core' },
        ]);
      if (url === '/api/v1/access/contexts')
        return respond([
          { id: SYSTEM_CONTEXT_ID, contextLevel: 10, instanceId: '0', path: '/1' },
          { id: TENANT_CONTEXT_ID, contextLevel: 20, instanceId: '1', path: '/1/2' },
        ]);
      if (url.startsWith('/api/v1/access/capability-matrix') && method === 'GET') {
        if (options.matrixBehavior === 'pending') return new Promise<Response>(() => {});
        const contextId = new URLSearchParams(url.split('?')[1] ?? '').get('contextId') ?? '';
        const roles = [
          { id: ROLE_A_ID, name: 'Giáo viên', userCount: 5 },
          { id: ROLE_B_ID, name: 'Quản trị viên', userCount: 2 },
        ];
        return respond({
          contextId,
          roles: roles.map((role) => ({
            ...role,
            overrides: Object.entries(store[contextId]?.[role.id] ?? {}).map(([capability, permission]) => ({
              capability,
              permission,
            })),
          })),
        });
      }
      if (url === '/api/v1/access/overrides' && method === 'POST') {
        if (options.postError)
          return respond({ type: 'about:blank', title: 'Không ghi được ô', status: 500 }, 500);
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          roleId: string;
          capability: string;
          contextId: string;
          permission: number;
        };
        const applyAndRespond = () => {
          const contextStore = (store[body.contextId] ??= {});
          const roleStore = (contextStore[body.roleId] ??= {});
          if (body.permission === 0) delete roleStore[body.capability];
          else roleStore[body.capability] = body.permission;
          options.afterPostApply?.(store);
          return respond({ updated: true });
        };
        if (options.onPostDeferred) {
          return new Promise<Response>((resolve, reject) => {
            options.onPostDeferred!({
              resolvePost: () => resolve(applyAndRespond()),
              rejectPost: (reason) => reject(reason ?? new Error('Lỗi ghi ô')),
            });
          });
        }
        return applyAndRespond();
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/admin/permissions', element: <AdminPermissionsPage /> }], {
    initialEntries: ['/admin/permissions'],
  });
  render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
}

async function chooseOption(trigger: HTMLElement, optionLabel: string) {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: optionLabel }));
}

function cellToggle(roleName: string, capability: string) {
  return screen.getByRole('button', { name: `Quyền ${capability} của vai trò ${roleName}` });
}

describe('Trang Quyền độc lập — ma trận toàn trang và ghi từng ô', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hiện đủ hàng resource, cột vai trò kèm số người giữ và mọi ô năng lực, thẻ đếm đúng tại ngữ cảnh hệ thống', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Quyền course:view của vai trò Giáo viên' });
    const matrixCalls = calls.filter((call) => call.url.startsWith('/api/v1/access/capability-matrix'));
    expect(matrixCalls).toHaveLength(1);
    expect(matrixCalls[0]?.url).toContain(`contextId=${SYSTEM_CONTEXT_ID}`);
    expect(screen.getByText('course')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    for (const roleName of ['Giáo viên', 'Quản trị viên']) {
      for (const capability of ['course:view', 'course:edit', 'user:view']) {
        expect(cellToggle(roleName, capability)).toBeInTheDocument();
        expect(cellToggle(roleName, capability)).toHaveAttribute('title', capability);
      }
    }
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: 'Tài nguyên' })).toBeInTheDocument();
    expect(screen.getByText('Giáo viên')).toBeInTheDocument();
    expect(screen.getByText('5 người dùng')).toBeInTheDocument();
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument();
    expect(screen.getByText('2 người dùng')).toBeInTheDocument();
    expect(screen.getByText('Vai trò')).toBeInTheDocument();
    expect(screen.getAllByText('Tài nguyên')).toHaveLength(2);
    expect(screen.getByText('Quyền đang cho phép')).toBeInTheDocument();
    const cards = document.querySelectorAll('[data-slot="card"]');
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cellToggle('Giáo viên', 'course:view')).toHaveAttribute('aria-pressed', 'true');
    expect(cellToggle('Quản trị viên', 'course:view')).toHaveAttribute('aria-pressed', 'false');
  });

  it('bật một ô gọi đúng một lần POST ghi từng ô với thân Cho phép và thẻ Cho phép tăng ngay 1, tắt ô Cho phép thì ghi Kế thừa và thẻ giảm ngay 1', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Quyền course:edit của vai trò Giáo viên' });
    expect(cell).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(cell);
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/access/overrides' && call.method === 'POST')).toHaveLength(1);
    });
    expect(calls.filter((call) => call.url === '/api/v1/access/overrides')[0]?.body).toEqual({
      roleId: ROLE_A_ID,
      capability: 'course:edit',
      contextId: SYSTEM_CONTEXT_ID,
      permission: 1,
    });
    const allowCard = screen.getByText('Quyền đang cho phép').closest('[data-slot="card"]');
    expect(within(allowCard as HTMLElement).getByText('2')).toBeInTheDocument();
    const allowCell = cellToggle('Giáo viên', 'course:view');
    await userEvent.click(allowCell);
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/access/overrides' && call.method === 'POST')).toHaveLength(2);
    });
    expect(calls.filter((call) => call.url === '/api/v1/access/overrides')[1]?.body).toEqual({
      roleId: ROLE_A_ID,
      capability: 'course:view',
      contextId: SYSTEM_CONTEXT_ID,
      permission: 0,
    });
    expect(within(allowCard as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  it('ghi ô lỗi thì ô hoàn lại giá trị cũ và hiện thông báo lỗi', async () => {
    stubFetch([], { postError: true });
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Quyền course:edit của vai trò Giáo viên' });
    expect(cell).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(cell);
    await screen.findByText('Không lưu được ô này — giá trị đã hoàn lại.');
    expect(cellToggle('Giáo viên', 'course:edit')).toHaveAttribute('aria-pressed', 'false');
  });

  it('đổi ngữ cảnh thì tải lại ma trận của ngữ cảnh mới và thẻ cập nhật theo', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Quyền course:view của vai trò Giáo viên' });
    expect(cellToggle('Giáo viên', 'course:view')).toHaveAttribute('aria-pressed', 'true');
    const picker = screen.getByLabelText('Ngữ cảnh');
    await chooseOption(picker, 'Trung tâm');
    await waitFor(() => {
      expect(
        calls.filter((call) => call.url.startsWith('/api/v1/access/capability-matrix')),
      ).toHaveLength(2);
    });
    expect(
      calls.filter((call) => call.url.startsWith('/api/v1/access/capability-matrix'))[1]?.url,
    ).toContain(`contextId=${TENANT_CONTEXT_ID}`);
    expect(cellToggle('Giáo viên', 'course:view')).toHaveAttribute('aria-pressed', 'false');
    expect(cellToggle('Giáo viên', 'course:edit')).toHaveAttribute('aria-pressed', 'true');
    expect(cellToggle('Quản trị viên', 'course:view')).toHaveAttribute('aria-pressed', 'true');
    const allowCard = screen.getByText('Quyền đang cho phép').closest('[data-slot="card"]');
    expect(within(allowCard as HTMLElement).getByText('2')).toBeInTheDocument();
  });

  it('đổi ngữ cảnh trong lúc lưu còn chờ thì ô cùng vị trí ở ngữ cảnh mới vẫn sửa được và lỗi muộn của ngữ cảnh cũ không hiện ở ngữ cảnh mới', async () => {
    const calls: RecordedCall[] = [];
    let postControls:
      | { resolvePost: () => void; rejectPost: (reason?: unknown) => void }
      | undefined;
    stubFetch(calls, {
      onPostDeferred: (controls) => {
        postControls = controls;
      },
    });
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Quyền course:edit của vai trò Giáo viên' });
    expect(cell).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(cell);
    await waitFor(() => {
      expect(cellToggle('Giáo viên', 'course:edit')).toBeDisabled();
      expect(postControls).toBeDefined();
    });
    const picker = screen.getByLabelText('Ngữ cảnh');
    await chooseOption(picker, 'Trung tâm');
    await waitFor(() => {
      expect(
        calls.filter((call) => call.url.startsWith('/api/v1/access/capability-matrix')),
      ).toHaveLength(2);
    });
    const tenantCell = cellToggle('Giáo viên', 'course:edit');
    expect(tenantCell).not.toBeDisabled();
    expect(tenantCell).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      postControls?.rejectPost(new Error('Lỗi ghi muộn'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText('Không lưu được ô này — giá trị đã hoàn lại.')).not.toBeInTheDocument();
    const pickerBack = screen.getByLabelText('Ngữ cảnh');
    await chooseOption(pickerBack, 'Hệ thống');
    await waitFor(() => {
      expect(cellToggle('Giáo viên', 'course:edit')).toHaveAttribute('aria-pressed', 'false');
    });
    const systemCell = cellToggle('Giáo viên', 'course:edit');
    expect(systemCell).not.toBeDisabled();
  });

  it('ghi ô thành công thì xoá nháp để giá trị mới từ server hiện lên thay vì bị nháp cũ che', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, {
      afterPostApply: (store) => {
        const roleStore = store[SYSTEM_CONTEXT_ID]?.[ROLE_A_ID];
        if (roleStore) roleStore['course:view'] = 1;
      },
    });
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Quyền course:view của vai trò Giáo viên' });
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(cell);
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/access/overrides' && call.method === 'POST')).toHaveLength(1);
    });
    expect(calls.filter((call) => call.url === '/api/v1/access/overrides')[0]?.body).toEqual({
      roleId: ROLE_A_ID,
      capability: 'course:view',
      contextId: SYSTEM_CONTEXT_ID,
      permission: 0,
    });
    await waitFor(() => {
      expect(cellToggle('Giáo viên', 'course:view')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('lỗi muộn của ngữ cảnh cũ không xoá nháp mới ở ngữ cảnh mới', async () => {
    const calls: RecordedCall[] = [];
    const posts: Array<{
      resolvePost: () => void;
      rejectPost: (reason?: unknown) => void;
    }> = [];
    stubFetch(calls, {
      onPostDeferred: (controls) => {
        posts.push(controls);
      },
    });
    renderPage();

    const systemCell = await screen.findByRole('button', { name: 'Quyền course:view của vai trò Giáo viên' });
    expect(systemCell).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(systemCell);
    await waitFor(() => expect(posts).toHaveLength(1));
    const picker = screen.getByLabelText('Ngữ cảnh');
    await chooseOption(picker, 'Trung tâm');
    await waitFor(() => {
      expect(
        calls.filter((call) => call.url.startsWith('/api/v1/access/capability-matrix')),
      ).toHaveLength(2);
    });
    const tenantCell = cellToggle('Giáo viên', 'course:view');
    expect(tenantCell).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(tenantCell);
    await waitFor(() => expect(posts).toHaveLength(2));
    await act(async () => {
      posts[0]?.rejectPost(new Error('Lỗi ghi muộn'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(cellToggle('Giáo viên', 'course:view')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.queryByText('Không lưu được ô này — giá trị đã hoàn lại.')).not.toBeInTheDocument();
    await act(async () => {
      posts[1]?.resolvePost();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('ma trận chưa tải xong thì không có ô nào sửa được', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { matrixBehavior: 'pending' });
    renderPage();

    await waitFor(() => {
      expect(calls.filter((call) => call.url.startsWith('/api/v1/access/capability-matrix'))).toHaveLength(1);
    });
    expect(screen.getByRole('heading', { name: 'Quyền' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Quyền course:view của vai trò Giáo viên' }),
    ).not.toBeInTheDocument();
  });

  it('ô đang mang Cấm hẳn hoặc Ngăn chặn thì bị khoá kèm huy hiệu trạng thái và không thao tác nào ghi đè được', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const prohibitCell = await screen.findByRole('button', {
      name: 'Quyền user:view của vai trò Quản trị viên',
    });
    expect(prohibitCell).toBeDisabled();
    expect(prohibitCell).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Cấm hẳn')).toBeInTheDocument();
    await userEvent.click(prohibitCell);
    expect(calls.filter((call) => call.url === '/api/v1/access/overrides')).toHaveLength(0);
    const picker = screen.getByLabelText('Ngữ cảnh');
    await chooseOption(picker, 'Trung tâm');
    const preventCell = await screen.findByRole('button', {
      name: 'Quyền user:view của vai trò Giáo viên',
    });
    expect(preventCell).toBeDisabled();
    expect(screen.getByText('Ngăn chặn')).toBeInTheDocument();
    await userEvent.click(preventCell);
    expect(calls.filter((call) => call.url === '/api/v1/access/overrides')).toHaveLength(0);
    expect(cellToggle('Giáo viên', 'course:view')).not.toBeDisabled();
  });

  it('tắt ô về Kế thừa rồi tải lại trang thì ô không còn ghi đè', async () => {
    stubFetch([]);
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Quyền course:view của vai trò Giáo viên' });
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(cell);
    await waitFor(() => {
      expect(cellToggle('Giáo viên', 'course:view')).toHaveAttribute('aria-pressed', 'false');
    });
    cleanup();
    renderPage();
    const reloaded = await screen.findByRole('button', {
      name: 'Quyền course:view của vai trò Giáo viên',
    });
    expect(reloaded).toHaveAttribute('aria-pressed', 'false');
  });
});
