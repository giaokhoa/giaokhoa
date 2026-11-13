import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
import { AdminRolesPage } from './admin-roles';

const ROLE_ID = '01900000-0000-7000-8000-0000000000b1';
const NEW_ROLE_ID = '01900000-0000-7000-8000-0000000000b2';
const SYSTEM_CONTEXT_ID = '01900000-0000-7000-8000-000000000010';
const TENANT_CONTEXT_ID = '01900000-0000-7000-8000-000000000020';
const USER_A_ID = '01900000-0000-7000-8000-0000000000a1';
const USER_B_ID = '01900000-0000-7000-8000-0000000000a2';
const USER_C_ID = '01900000-0000-7000-8000-0000000000a3';
const ASSIGN_A_ID = '01900000-0000-7000-8000-0000000000d1';
const ASSIGN_B_ID = '01900000-0000-7000-8000-0000000000d2';
const ASSIGN_C_ID = '01900000-0000-7000-8000-0000000000d3';
const COURSE_A_CONTEXT_ID = '01900000-0000-7000-8000-000000000050';
const COURSE_B_CONTEXT_ID = '01900000-0000-7000-8000-000000000051';

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

interface StubOptions {
  deleteErrorCode?: string;
  matrixBehavior?: 'pending' | 'errorOnce' | 'errorAlways';
  roleArchetype?: string | null;
  roleUserCount?: number;
  assignErrorCode?: string;
  unassignErrorCode?: string;
  assignmentsTotal?: number;
  nullUserRow?: boolean;
  pagedAssignmentsTotal?: number;
  pagedUsersTotal?: number;
  dualCourseAssignments?: boolean;
  prohibitMatrix?: boolean;
  rolesError?: boolean;
  capabilitiesError?: boolean;
}

function stubFetch(calls: RecordedCall[], options: StubOptions = {}) {
  let matrixCalls = 0;
  let pagedRows: Array<Record<string, unknown>> | null =
    options.pagedAssignmentsTotal === undefined
      ? null
      : Array.from({ length: options.pagedAssignmentsTotal }, (_, i) => ({
          id: `01900000-0000-7000-8000-0000000000${String(i + 1).padStart(2, '0')}`,
          roleId: ROLE_ID,
          userId: `01900000-0000-7000-8000-0000000001${String(i + 1).padStart(2, '0')}`,
          contextId: SYSTEM_CONTEXT_ID,
          component: '',
          itemId: null,
          modifierId: null,
          updatedAt: '2026-10-01T00:00:00.000Z',
          userName: `Người dùng ${i + 1}`,
          userEmail: `nguoidung${i + 1}@example.com`,
        }));
  const pagedUsers: Array<Record<string, unknown>> | null =
    options.pagedUsersTotal === undefined
      ? null
      : Array.from({ length: options.pagedUsersTotal }, (_, i) => ({
          id: `01900000-0000-7000-8000-0000000002${String(i + 1).padStart(2, '0')}`,
          username: `nguoidung${i + 1}`,
          email: `nguoidung${i + 1}@example.com`,
          firstName: `Người ${i + 1}`,
          lastName: 'Dùng',
        }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const respond = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/v1/access/roles' && method === 'GET') {
        if (options.rolesError)
          return respond({ type: 'about:blank', title: 'Lỗi tải vai trò', status: 500 }, 500);
        return respond([
          {
            id: ROLE_ID,
            name: 'Giáo viên',
            shortName: 'editingteacher',
            description: '',
            archetype: options.roleArchetype === undefined ? 'editingteacher' : options.roleArchetype,
            userCount: options.roleUserCount ?? 5,
            overrideCount: 3,
            readOverrideCount: 2,
            writeOverrideCount: 1,
            resourceCount: 2,
          },
        ]);
      }
      if (url === '/api/v1/access/capabilities') {
        if (options.capabilitiesError)
          return respond({ type: 'about:blank', title: 'Lỗi tải danh mục', status: 500 }, 500);
        return respond([
          {
            id: '01900000-0000-7000-8000-0000000000c1',
            name: 'course:view',
            capType: 'read',
            contextLevel: 50,
            component: 'core',
          },
          {
            id: '01900000-0000-7000-8000-0000000000c2',
            name: 'course:edit',
            capType: 'write',
            contextLevel: 50,
            component: 'core',
          },
          {
            id: '01900000-0000-7000-8000-0000000000c3',
            name: 'user:view',
            capType: 'read',
            contextLevel: 30,
            component: 'core',
          },
        ]);
      }
      if (url === '/api/v1/access/contexts')
        return respond([
          { id: SYSTEM_CONTEXT_ID, contextLevel: 10, instanceId: '0', path: '/1' },
          { id: TENANT_CONTEXT_ID, contextLevel: 20, instanceId: '1', path: '/1/2' },
          ...(options.dualCourseAssignments
            ? [
                { id: COURSE_A_CONTEXT_ID, contextLevel: 50, instanceId: '10', path: '/1/10' },
                { id: COURSE_B_CONTEXT_ID, contextLevel: 50, instanceId: '11', path: '/1/11' },
              ]
            : []),
        ]);
      if (url.startsWith('/api/v1/access/assignments') && method === 'GET') {
        const query = new URLSearchParams(url.split('?')[1] ?? '');
        const page = Number(query.get('page') ?? 1);
        const pageSize = Number(query.get('pageSize') ?? 20);
        if (pagedRows !== null) {
          const start = (page - 1) * pageSize;
          return respond({
            assignments: pagedRows.slice(start, start + pageSize),
            total: pagedRows.length,
            page,
            pageSize,
          });
        }
        return respond({
          assignments: [
            {
              id: ASSIGN_A_ID,
              roleId: ROLE_ID,
              userId: USER_A_ID,
              contextId: SYSTEM_CONTEXT_ID,
              component: '',
              itemId: null,
              modifierId: null,
              updatedAt: '2026-10-01T00:00:00.000Z',
              userName: options.nullUserRow ? null : 'An Nguyễn',
              userEmail: options.nullUserRow ? null : 'an@example.com',
            },
            {
              id: ASSIGN_B_ID,
              roleId: ROLE_ID,
              userId: USER_B_ID,
              contextId: TENANT_CONTEXT_ID,
              component: 'enrol',
              itemId: '01900000-0000-7000-8000-0000000000e1',
              modifierId: null,
              updatedAt: '2026-10-02T00:00:00.000Z',
              userName: 'Bình Trần',
              userEmail: 'binh@example.com',
            },
          ],
          total: options.assignmentsTotal ?? 2,
          page,
          pageSize,
        });
      }
      if (url.startsWith('/api/v1/access/users-with-assignments') && method === 'GET') {
        const query = new URLSearchParams(url.split('?')[1] ?? '');
        const page = Number(query.get('page') ?? 1);
        const pageSize = Number(query.get('pageSize') ?? 10);
        const search = (query.get('search') ?? '').toLowerCase();
        const roleId = query.get('roleId') ?? '';
        const status = query.get('status') ?? '';
        const allUsers = [
          {
            id: USER_A_ID,
            username: 'annguyen',
            firstName: 'An',
            lastName: 'Nguyễn',
            email: 'an@example.com',
            suspended: false,
            deleted: false,
            createdAt: '2026-10-01T00:00:00.000Z',
            assignments: options.dualCourseAssignments
              ? [
                  { id: ASSIGN_A_ID, roleId: ROLE_ID, roleName: 'Giáo viên', contextId: COURSE_A_CONTEXT_ID, contextLevel: 50, component: '' },
                  { id: ASSIGN_C_ID, roleId: ROLE_ID, roleName: 'Giáo viên', contextId: COURSE_B_CONTEXT_ID, contextLevel: 50, component: '' },
                ]
              : [
                  { id: ASSIGN_A_ID, roleId: ROLE_ID, roleName: 'Giáo viên', contextId: SYSTEM_CONTEXT_ID, contextLevel: 10, component: '' },
                ],
          },
          {
            id: USER_B_ID,
            username: 'binhtran',
            firstName: 'Bình',
            lastName: 'Trần',
            email: 'binh@example.com',
            suspended: false,
            deleted: false,
            createdAt: '2026-10-02T00:00:00.000Z',
            assignments: [
              { id: ASSIGN_B_ID, roleId: ROLE_ID, roleName: 'Giáo viên', contextId: TENANT_CONTEXT_ID, contextLevel: 20, component: 'enrol' },
            ],
          },
          {
            id: USER_C_ID,
            username: 'colan',
            firstName: 'Cô',
            lastName: 'Lan',
            email: 'co@example.com',
            suspended: true,
            deleted: false,
            createdAt: '2026-10-03T00:00:00.000Z',
            assignments: [],
          },
        ];
        const filtered = allUsers.filter((user) => {
          if (status === 'active' && (user.suspended || user.deleted)) return false;
          if (status === 'suspended' && !user.suspended) return false;
          if (status === 'deleted' && !user.deleted) return false;
          if (status === '' && user.deleted) return false;
          if (roleId !== '' && !user.assignments.some((a) => a.roleId === roleId)) return false;
          if (
            search !== '' &&
            !`${user.username} ${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(search)
          )
            return false;
          return true;
        });
        const start = (page - 1) * pageSize;
        return respond({
          users: filtered.slice(start, start + pageSize),
          total: filtered.length,
          page,
          pageSize,
        });
      }
      if (url.startsWith('/api/v1/users') && method === 'GET') {
        if (pagedUsers !== null) {
          const query = new URLSearchParams(url.split('?')[1] ?? '');
          const page = Number(query.get('page') ?? 1);
          const pageSize = Number(query.get('pageSize') ?? 20);
          const search = (query.get('search') ?? '').toLowerCase();
          const filtered =
            search === ''
              ? pagedUsers
              : pagedUsers.filter((u) => `${u.username} ${u.email}`.toLowerCase().includes(search));
          const start = (page - 1) * pageSize;
          return respond({ users: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
        }
        return respond({
          users: [
            {
              id: USER_A_ID,
              username: 'annguyen',
              email: 'an@example.com',
              firstName: 'An',
              lastName: 'Nguyễn',
            },
            { id: USER_C_ID, username: 'colan', email: 'co@example.com', firstName: 'Cô', lastName: 'Lan' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        });
      }
      if (url === '/api/v1/access/assignments' && method === 'POST') {
        if (options.assignErrorCode)
          return respond(
            { type: 'about:blank', title: 'Không gán được vai trò', status: 400, code: options.assignErrorCode },
            400,
          );
        return respond({});
      }
      if (url.startsWith('/api/v1/access/assignments/') && method === 'DELETE') {
        if (pagedRows !== null) {
          const id = url.split('/').pop() ?? '';
          pagedRows = pagedRows.filter((r) => r.id !== id);
        }
        if (options.unassignErrorCode)
          return respond(
            { type: 'about:blank', title: 'Không gỡ được dòng gán', status: 400, code: options.unassignErrorCode },
            400,
          );
        return respond({ deleted: true });
      }
      if (url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && method === 'GET') {
        if (options.matrixBehavior === 'pending') return new Promise<Response>(() => {});
        if (options.matrixBehavior === 'errorAlways')
          return respond({ type: 'about:blank', title: 'Lỗi tải ma trận', status: 500 }, 500);
        if (options.matrixBehavior === 'errorOnce') {
          matrixCalls += 1;
          if (matrixCalls === 1) return respond({ type: 'about:blank', title: 'Lỗi tải ma trận', status: 500 }, 500);
        }
        if (options.prohibitMatrix)
          return respond([
            { roleId: ROLE_ID, capability: 'course:view', contextId: SYSTEM_CONTEXT_ID, permission: -1 },
            { roleId: ROLE_ID, capability: 'course:edit', contextId: SYSTEM_CONTEXT_ID, permission: -1000 },
            { roleId: ROLE_ID, capability: 'user:view', contextId: SYSTEM_CONTEXT_ID, permission: 1 },
          ]);
        return respond([
          { roleId: ROLE_ID, capability: 'course:view', contextId: SYSTEM_CONTEXT_ID, permission: -1 },
          { roleId: ROLE_ID, capability: 'course:edit', contextId: TENANT_CONTEXT_ID, permission: 1 },
        ]);
      }
      if (url === '/api/v1/access/roles' && method === 'POST')
        return respond({
          id: NEW_ROLE_ID,
          name: 'Vai trò mới',
          shortName: 'newrole',
          description: '',
          archetype: null,
        });
      if (url === `/api/v1/access/roles/${ROLE_ID}` && method === 'PATCH') return respond({});
      if (url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities` && method === 'PUT') return respond([]);
      if (url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && method === 'PUT') return respond([]);
      if (url === `/api/v1/access/roles/${ROLE_ID}` && method === 'DELETE') {
        if (options.deleteErrorCode)
          return respond(
            { type: 'about:blank', title: 'Không xoá được vai trò', status: 400, code: options.deleteErrorCode },
            400,
          );
        return respond({ deleted: true });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/admin/roles', element: <AdminRolesPage /> }], {
    initialEntries: ['/admin/roles'],
  });
  render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
}

async function openEditDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Thao tác với vai trò' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Sửa vai trò' }));
  await screen.findByRole('dialog', { name: 'Sửa vai trò' });
}

async function chooseOption(trigger: HTMLElement, optionLabel: string) {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('Trang vai trò — lưới thẻ và hộp thoại ma trận (đợt 2, #546)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('tải vai, capability và context qua các query access và hiện thẻ với dữ kiện tổng hợp', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    expect(screen.getByText('5 người dùng')).toBeInTheDocument();
    const roleCard = screen.getByRole('button', { name: 'Thao tác với vai trò' }).closest('[data-slot="card"]');
    expect(roleCard).not.toBeNull();
    const cardScope = within(roleCard as HTMLElement);
    expect(cardScope.getByText('Đọc')).toBeInTheDocument();
    expect(cardScope.getByText('Ghi')).toBeInTheDocument();
    expect(cardScope.getByText('Tổng')).toBeInTheDocument();
    expect(cardScope.getAllByText('2')).toHaveLength(2);
    expect(cardScope.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(/editingteacher/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nguyên mẫu/)).not.toBeInTheDocument();
    expect(screen.getByText('Thêm một vai trò, nếu vai trò đó chưa tồn tại.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vai trò mới' })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/v1/access/roles')).toBe(true);
    expect(calls.some((c) => c.url === '/api/v1/access/capabilities')).toBe(true);
    expect(calls.some((c) => c.url === '/api/v1/access/contexts')).toBe(true);
  });

  it('tạo vai trò mới qua thẻ thêm rồi lưu ma trận bằng đúng một lần gọi thay toàn bộ', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vai trò mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm vai trò mới' });
    await userEvent.type(within(dialog).getByLabelText('Tên vai trò'), 'Vai trò mới');
    await userEvent.type(within(dialog).getByLabelText('Tên ngắn (shortName)'), 'newrole');
    await chooseOption(within(dialog).getByLabelText('Ngữ cảnh'), 'Hệ thống');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'course:view' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/access/roles' && c.method === 'POST')).toBe(true));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities` && c.method === 'PUT'),
      ).toBe(true),
    );
    const put = calls.find((c) => c.url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities`);
    expect(put?.body).toEqual({
      contextId: SYSTEM_CONTEXT_ID,
      overrides: [{ capability: 'course:view', permission: 1 }],
    });
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sửa vai trò: ô đang mang Ngăn chặn bị khoá kèm huy hiệu, chọn toàn cục không ghi đè được và giá trị giữ nguyên khi lưu', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await openEditDialog();
    const dialog = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    const lockedBox = await within(dialog).findByRole('checkbox', { name: 'course:view' });
    expect(lockedBox).toHaveAttribute('aria-disabled', 'true');
    expect(lockedBox).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByText('Ngăn chặn')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('row')).toHaveLength(3);
    expect(within(dialog).getByRole('columnheader', { name: 'Tài nguyên' })).toBeInTheDocument();
    expect(within(dialog).getByText('Đọc')).toBeInTheDocument();
    expect(within(dialog).getByText('Ghi')).toBeInTheDocument();
    await userEvent.click(lockedBox);
    expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const selectAll = within(dialog).getByRole('checkbox', { name: 'Chọn tất cả các quyền' });
    expect(selectAll).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(selectAll);
    expect(within(dialog).getByRole('checkbox', { name: 'course:edit' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'user:view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT')).toBe(
        true,
      ),
    );
    const put = calls.find((c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT');
    expect(put?.body).toEqual({
      contextId: SYSTEM_CONTEXT_ID,
      overrides: [
        { capability: 'course:view', permission: -1 },
        { capability: 'course:edit', permission: 1 },
        { capability: 'user:view', permission: 1 },
      ],
    });
  });

  it('sửa vai trò: chọn toàn cục giữ nguyên cả Ngăn chặn lẫn Cấm hẳn khi lưu, bỏ tích ô Cho phép thì năng lực rời khỏi tập ghi đè', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { prohibitMatrix: true });
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await openEditDialog();
    const dialog = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    const preventBox = await within(dialog).findByRole('checkbox', { name: 'course:view' });
    expect(preventBox).toHaveAttribute('aria-disabled', 'true');
    expect(preventBox).toHaveAttribute('aria-checked', 'false');
    const prohibitBox = within(dialog).getByRole('checkbox', { name: 'course:edit' });
    expect(prohibitBox).toHaveAttribute('aria-disabled', 'true');
    expect(prohibitBox).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByText('Ngăn chặn')).toBeInTheDocument();
    expect(within(dialog).getByText('Cấm hẳn')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'user:view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(prohibitBox);
    expect(within(dialog).getByRole('checkbox', { name: 'course:edit' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const selectAll = within(dialog).getByRole('checkbox', { name: 'Chọn tất cả các quyền' });
    expect(selectAll).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(selectAll);
    expect(within(dialog).getByRole('checkbox', { name: 'user:view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Chọn tất cả các quyền' }));
    expect(within(dialog).getByRole('checkbox', { name: 'user:view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:edit' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:edit' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT'),
      ).toBe(true),
    );
    const firstPut = calls.find(
      (c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT',
    );
    expect(firstPut?.body).toEqual({
      contextId: SYSTEM_CONTEXT_ID,
      overrides: [
        { capability: 'course:view', permission: -1 },
        { capability: 'course:edit', permission: -1000 },
        { capability: 'user:view', permission: 1 },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openEditDialog();
    const dialogAgain = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    const allowedBox = await within(dialogAgain).findByRole('checkbox', { name: 'user:view' });
    expect(allowedBox).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(allowedBox);
    expect(within(dialogAgain).getByRole('checkbox', { name: 'user:view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await userEvent.click(within(dialogAgain).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT')
          .length,
      ).toBe(2),
    );
    const puts = calls.filter(
      (c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT',
    );
    expect(puts[1]?.body).toEqual({
      contextId: SYSTEM_CONTEXT_ID,
      overrides: [
        { capability: 'course:view', permission: -1 },
        { capability: 'course:edit', permission: -1000 },
      ],
    });
  });

  it('sửa vai trò nạp đúng ghi đè của ngữ cảnh đang chọn và không lẫn sang ngữ cảnh khác', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await openEditDialog();
    const dialog = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    await chooseOption(within(dialog).getByLabelText('Ngữ cảnh'), 'Trung tâm');
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(
      within(dialog).getByRole('checkbox', { name: 'course:view' }).getAttribute('aria-disabled'),
    ).not.toBe('true');
    expect(within(dialog).getByRole('checkbox', { name: 'course:edit' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'course:view' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT')).toBe(
        true,
      ),
    );
    const put = calls.find((c) => c.url === `/api/v1/access/roles/${ROLE_ID}/capabilities` && c.method === 'PUT');
    expect(put?.body).toEqual({
      contextId: TENANT_CONTEXT_ID,
      overrides: [
        { capability: 'course:view', permission: 1 },
        { capability: 'course:edit', permission: 1 },
      ],
    });
  });

  it('chọn tất cả toàn cục bật mọi ô sửa được rồi lưu qua một lần gọi thay toàn bộ', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vai trò mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm vai trò mới' });
    await userEvent.type(within(dialog).getByLabelText('Tên vai trò'), 'Vai trò mới');
    await userEvent.type(within(dialog).getByLabelText('Tên ngắn (shortName)'), 'newrole');
    await chooseOption(within(dialog).getByLabelText('Ngữ cảnh'), 'Hệ thống');
    const selectAll = within(dialog).getByRole('checkbox', { name: 'Chọn tất cả các quyền' });
    expect(selectAll).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'course:view' }));
    expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
    await userEvent.click(selectAll);
    for (const name of ['course:view', 'course:edit', 'user:view']) {
      expect(within(dialog).getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'true');
    }
    expect(selectAll).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities` && c.method === 'PUT'),
      ).toBe(true),
    );
    const put = calls.find((c) => c.url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities`);
    expect(put?.body).toEqual({
      contextId: SYSTEM_CONTEXT_ID,
      overrides: [
        { capability: 'course:view', permission: 1 },
        { capability: 'course:edit', permission: 1 },
        { capability: 'user:view', permission: 1 },
      ],
    });
  });

  it('chọn tất cả theo nhóm resource chỉ bật các năng lực trong cùng nhóm', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vai trò mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm vai trò mới' });
    await userEvent.type(within(dialog).getByLabelText('Tên vai trò'), 'Vai trò mới');
    await userEvent.type(within(dialog).getByLabelText('Tên ngắn (shortName)'), 'newrole');
    await chooseOption(within(dialog).getByLabelText('Ngữ cảnh'), 'Hệ thống');
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Chọn tất cả quyền của nhóm course' }),
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'course:edit' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: 'user:view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities` && c.method === 'PUT'),
      ).toBe(true),
    );
    const put = calls.find((c) => c.url === `/api/v1/access/roles/${NEW_ROLE_ID}/capabilities`);
    expect(put?.body).toEqual({
      contextId: SYSTEM_CONTEXT_ID,
      overrides: [
        { capability: 'course:view', permission: 1 },
        { capability: 'course:edit', permission: 1 },
      ],
    });
  });

  it('sửa vai trò khi ma trận chưa tải xong thì nút Lưu bị chặn và không phát sinh yêu cầu ghi', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { matrixBehavior: 'pending' });
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await openEditDialog();
    const dialog = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    expect(within(dialog).getByText('Đang tải…')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Lưu vai trò' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'PATCH')).toBe(false);
  });

  it('sửa vai trò khi tải ma trận lỗi thì hiện lỗi, chặn Lưu, và thử lại tải được ma trận', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { matrixBehavior: 'errorOnce' });
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await openEditDialog();
    const dialog = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    expect(
      await within(dialog).findByText('Không tải được ma trận quyền của vai trò. Thử tải lại trước khi lưu.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Lưu vai trò' })).toBeDisabled();
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'PATCH')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thử lại' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    expect(within(dialog).getByText('Ngăn chặn')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Lưu vai trò' })).toBeEnabled();
  });

  it('xoá vai trò bị backend chặn thì hiển thị đúng lý do và giữ nguyên vai trò', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { deleteErrorCode: 'access.role_has_assignments' });
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thao tác với vai trò' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Xoá vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xoá vai trò' });
    expect(within(dialog).getByText(/Xoá vai trò “Giáo viên”/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vai trò' }));
    await waitFor(() => expect(screen.getByText('Vai trò vẫn còn người giữ nên không xoá được.')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Xoá vai trò' })).toBeInTheDocument();
    expect(screen.getByText('5 người dùng')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('xoá vai trò thường không còn người giữ thì thành công và hộp thoại đóng', async () => {
    stubFetch([], { roleArchetype: null, roleUserCount: 0 });
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thao tác với vai trò' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Xoá vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xoá vai trò' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vai trò' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('hộp thoại vai trò có đúng một nút Huỷ, dòng mô tả phụ theo chế độ và nút × đóng được hộp thoại', async () => {
    stubFetch([]);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vai trò mới' }));
    const createDialog = await screen.findByRole('dialog', { name: 'Thêm vai trò mới' });
    expect(within(createDialog).getByText('Tạo vai trò mới và cấu hình quyền của nó.')).toBeInTheDocument();
    expect(within(createDialog).getAllByRole('button', { name: 'Huỷ' })).toHaveLength(1);
    await userEvent.click(within(createDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openEditDialog();
    const editDialog = screen.getByRole('dialog', { name: 'Sửa vai trò' });
    expect(
      within(editDialog).getByText('Cập nhật tên vai trò và đặt quyền theo từng resource.'),
    ).toBeInTheDocument();
    expect(within(editDialog).getAllByRole('button', { name: 'Huỷ' })).toHaveLength(1);
    await userEvent.click(within(editDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('tên vai trò ngắn hơn 2 ký tự thì báo lỗi ngay tại trường và chặn Lưu, đủ 2 ký tự thì hết lỗi', async () => {
    stubFetch([]);
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vai trò mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm vai trò mới' });
    const nameInput = within(dialog).getByLabelText('Tên vai trò');
    expect(nameInput).toHaveAttribute('placeholder', 'Nhập tên vai trò');
    await userEvent.type(nameInput, 'A');
    expect(within(dialog).getByText('Tên vai trò phải có ít nhất 2 ký tự.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Lưu vai trò' })).toBeDisabled();
    await userEvent.type(nameInput, 'B');
    expect(within(dialog).queryByText('Tên vai trò phải có ít nhất 2 ký tự.')).not.toBeInTheDocument();
  });

  it('một query phụ lỗi khi chưa có dữ kiện thì báo tại chỗ, lưới vai vẫn hiện và không có banner toàn trang', async () => {
    stubFetch([], { capabilitiesError: true });
    renderPage();

    await screen.findByRole('button', { name: 'Thêm vai trò mới' });
    expect(screen.getByText('5 người dùng')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Không tải được danh mục quyền hoặc cây ngữ cảnh — hộp thoại ma trận có thể chưa đầy đủ.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Không tải được danh sách vai trò. Thử tải lại.')).not.toBeInTheDocument();
  });

  it('danh sách vai lỗi ở lần tải đầu thì hiện banner lỗi toàn trang kèm nút thử lại', async () => {
    stubFetch([], { rolesError: true });
    renderPage();

    expect(await screen.findByText('Không tải được danh sách vai trò. Thử tải lại.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});

describe('Trang vai trò — bảng gán vai (đợt 3, #547)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function assignmentsCard(): HTMLElement {
    const card = screen.getByText('Người dùng và vai trò của họ').closest('[data-slot="card"]');
    if (!card) throw new Error('Không tìm thấy thẻ bảng gán vai');
    return card as HTMLElement;
  }

  async function openAssignDialog() {
    await userEvent.click(within(assignmentsCard()).getByRole('button', { name: 'Gán vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gán vai trò' });
    const userButton = await within(dialog).findByRole('button', { name: /annguyen/ });
    await userEvent.click(userButton);
    return dialog;
  }

  it('hiện đủ cột, dòng enrol-managed không có nút gỡ mà hiện lý do', async () => {
    stubFetch([]);
    renderPage();

    await screen.findByText('An Nguyễn');
    const table = within(assignmentsCard()).getByRole('table');
    for (const header of ['Người dùng', 'Vai trò', 'Ngữ cảnh', 'Ngày gán', 'Thao tác']) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
    expect(within(table).queryByText('Plan')).not.toBeInTheDocument();
    expect(within(table).queryByText('Billing')).not.toBeInTheDocument();
    expect(within(table).getAllByText('Giáo viên')).toHaveLength(2);
    expect(within(table).getByText('Hệ thống')).toBeInTheDocument();
    expect(within(table).getByText('Trung tâm')).toBeInTheDocument();
    expect(screen.queryByText(/thực thể/)).not.toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: 'Gỡ gán' })).toHaveLength(1);
    expect(within(table).getByText('Không gỡ trực tiếp được — gỡ bằng cách rút ghi danh')).toBeInTheDocument();
    expect(screen.queryByText(/Export/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Import/)).not.toBeInTheDocument();
  });

  it('lọc theo vai trò và ngữ cảnh, tìm kiếm, đổi cỡ trang và chuyển trang đều gửi tham số lên server', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { assignmentsTotal: 25 });
    renderPage();

    await screen.findByText('An Nguyễn');
    const card = within(assignmentsCard());
    const assignmentsCalls = () =>
      calls.filter((c) => c.url.startsWith('/api/v1/access/assignments') && c.method === 'GET');

    await userEvent.type(card.getByLabelText('Tìm người dùng'), 'An');
    await waitFor(() => expect(assignmentsCalls().some((c) => c.url.includes('search=An'))).toBe(true));

    await chooseOption(card.getByLabelText('Lọc theo vai trò'), 'Giáo viên');
    await waitFor(() => expect(assignmentsCalls().some((c) => c.url.includes(`roleId=${ROLE_ID}`))).toBe(true));

    await chooseOption(card.getByLabelText('Lọc theo ngữ cảnh'), 'Trung tâm');
    await waitFor(() =>
      expect(assignmentsCalls().some((c) => c.url.includes(`contextId=${TENANT_CONTEXT_ID}`))).toBe(true),
    );

    await chooseOption(card.getByLabelText('Số dòng mỗi trang'), '10');
    await waitFor(() => expect(assignmentsCalls().some((c) => c.url.includes('pageSize=10'))).toBe(true));
    expect(card.getByText('Hiển thị 1–2 trong 25 dòng')).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(assignmentsCalls().some((c) => c.url.includes('page=2'))).toBe(true));
    expect(card.getByText('Hiển thị 11–12 trong 25 dòng')).toBeInTheDocument();
  });

  it('gán vai qua hộp thoại POST đúng bộ ba và làm mới các truy vấn access', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByText('An Nguyễn');
    const roleLoadsBefore = calls.filter((c) => c.url === '/api/v1/access/roles' && c.method === 'GET').length;
    const dialog = await openAssignDialog();
    expect(within(dialog).getByLabelText('Ngữ cảnh')).toHaveTextContent('Hệ thống');
    await chooseOption(within(dialog).getByLabelText('Vai trò'), 'Giáo viên');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gán vai trò' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/access/assignments' && c.method === 'POST')).toBe(true),
    );
    const post = calls.find((c) => c.url === '/api/v1/access/assignments' && c.method === 'POST');
    expect(post?.body).toEqual({ userId: USER_A_ID, roleId: ROLE_ID, contextId: SYSTEM_CONTEXT_ID });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/v1/access/roles' && c.method === 'GET').length).toBeGreaterThan(
        roleLoadsBefore,
      ),
    );
  });

  it('gán trúng chốt gói số chỗ thì hiện đúng lý do và giữ hộp thoại mở', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { assignErrorCode: 'plan.tenant_slot_limit_reached' });
    renderPage();

    await screen.findByText('An Nguyễn');
    const dialog = await openAssignDialog();
    await chooseOption(within(dialog).getByLabelText('Vai trò'), 'Giáo viên');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gán vai trò' }));

    expect(
      await within(dialog).findByText(
        'Trung tâm đã chạm hạn mức gói nên không gán thêm vai trò giảng dạy được.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Gán vai trò' })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/v1/access/assignments' && c.method === 'POST')).toBe(true);
  });

  it('gán trúng chốt tách vai thì hiện đúng lý do và giữ hộp thoại mở', async () => {
    stubFetch([], { assignErrorCode: 'access.role_context_conflict' });
    renderPage();

    await screen.findByText('An Nguyễn');
    const dialog = await openAssignDialog();
    await chooseOption(within(dialog).getByLabelText('Vai trò'), 'Giáo viên');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gán vai trò' }));

    expect(
      await within(dialog).findByText(
        'Người này đang là học viên đang hoạt động của khoá/lớp đó nên không nhận thêm vai trò giảng dạy tại đây.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Gán vai trò' })).toBeInTheDocument();
  });

  it('gỡ dòng gán sau xác nhận thì DELETE đúng id và bảng tải lại', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    await screen.findByText('An Nguyễn');
    const assignmentsBefore = calls.filter(
      (c) => c.url.startsWith('/api/v1/access/assignments') && c.method === 'GET',
    ).length;
    await userEvent.click(screen.getByRole('button', { name: 'Gỡ gán' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ gán vai trò' });
    expect(within(dialog).getByText(/Gỡ vai trò “Giáo viên” của An Nguyễn tại Hệ thống/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gỡ gán' }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/access/assignments/${ASSIGN_A_ID}` && c.method === 'DELETE'),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url.startsWith('/api/v1/access/assignments') && c.method === 'GET').length,
      ).toBeGreaterThan(assignmentsBefore),
    );
  });

  it('gỡ bị backend từ chối bằng mã enrol-managed thì hiện đúng lý do và giữ hộp thoại mở', async () => {
    stubFetch([], { unassignErrorCode: 'access.assignment_enrol_managed' });
    renderPage();

    await screen.findByText('An Nguyễn');
    await userEvent.click(screen.getByRole('button', { name: 'Gỡ gán' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ gán vai trò' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gỡ gán' }));

    expect(
      await within(dialog).findByText('Không gỡ trực tiếp được — gỡ bằng cách rút ghi danh'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Gỡ gán vai trò' })).toBeInTheDocument();
  });

  it('dòng trỏ tới người dùng không còn tồn tại hiện trạng thái thay cho tên', async () => {
    stubFetch([], { nullUserRow: true });
    renderPage();

    await screen.findByText('Người dùng không còn tồn tại');
    const table = within(assignmentsCard()).getByRole('table');
    expect(within(table).getByText('Người dùng không còn tồn tại')).toBeInTheDocument();
  });

  it('gỡ dòng duy nhất của trang cuối thì bảng tự về trang hợp lệ cuối cùng thay vì kẹt ở trang rỗng', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { pagedAssignmentsTotal: 21 });
    renderPage();

    await screen.findByText('Người dùng 1');
    const card = within(assignmentsCard());
    expect(card.getByText('Hiển thị 1–20 trong 21 dòng')).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(card.getByText('Hiển thị 21–21 trong 21 dòng')).toBeInTheDocument());
    expect(card.getByText('Người dùng 21')).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Gỡ gán' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ gán vai trò' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gỡ gán' }));
    await waitFor(() => expect(card.getByText('Hiển thị 1–20 trong 20 dòng')).toBeInTheDocument());
    expect(card.getByText('Người dùng 1')).toBeInTheDocument();
    expect(card.queryByText('Hiển thị 21–21 trong 20 dòng')).not.toBeInTheDocument();
    expect(card.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(
      calls.some(
        (c) =>
          c.url === '/api/v1/access/assignments/01900000-0000-7000-8000-000000000021' && c.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('bộ chọn người dùng tải thêm được khi kết quả khớp vượt quá 20 người', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { pagedUsersTotal: 25 });
    renderPage();

    await screen.findByText('An Nguyễn');
    await userEvent.click(within(assignmentsCard()).getByRole('button', { name: 'Gán vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gán vai trò' });
    await within(dialog).findByRole('button', { name: /nguoidung1@/ });
    expect(within(dialog).queryByRole('button', { name: /nguoidung21@/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Tải thêm người dùng' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tải thêm người dùng' }));
    await within(dialog).findByRole('button', { name: /nguoidung21@/ });
    expect(
      calls.some((c) => c.url.startsWith('/api/v1/users') && c.url.includes('pageSize=40')),
    ).toBe(true);
  });

  it('bảng có mô tả phụ dưới tiêu đề, vùng lọc đúng hai khối và chân bảng hiện khoảng dòng ngay cả khi một trang', async () => {
    stubFetch([]);
    renderPage();

    await screen.findByText('An Nguyễn');
    const card = within(assignmentsCard());
    expect(card.getByText('Mọi người dùng đang giữ vai trò và ngữ cảnh họ được gán.')).toBeInTheDocument();
    const searchField = card.getByLabelText('Tìm người dùng').closest('[data-slot="field"]');
    expect(searchField?.className).toContain('max-w-2xs');
    expect(card.getByLabelText('Lọc theo vai trò')).toBeInTheDocument();
    expect(card.getByLabelText('Lọc theo ngữ cảnh')).toBeInTheDocument();
    expect(card.getByText('Hiển thị 1–2 trong 2 dòng')).toBeInTheDocument();
    expect(card.queryByText('Trang 1 / 1')).not.toBeInTheDocument();
    expect(card.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Sau' })).toBeDisabled();
    expect(card.getByRole('button', { name: 'Trước' })).toBeDisabled();
  });

  it('tải thêm người dùng dừng ở trần 100 và gợi ý thu hẹp từ khoá thay vì gửi pageSize vượt trần', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { pagedUsersTotal: 105 });
    renderPage();

    await screen.findByText('An Nguyễn');
    await userEvent.click(within(assignmentsCard()).getByRole('button', { name: 'Gán vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gán vai trò' });
    const loadMore = () => within(dialog).getByRole('button', { name: 'Tải thêm người dùng' });
    await userEvent.click(loadMore());
    await within(dialog).findByRole('button', { name: /nguoidung21@/ });
    await userEvent.click(loadMore());
    await within(dialog).findByRole('button', { name: /nguoidung41@/ });
    await userEvent.click(loadMore());
    await within(dialog).findByRole('button', { name: /nguoidung61@/ });
    await userEvent.click(loadMore());
    await within(dialog).findByRole('button', { name: /nguoidung100@/ });
    expect(within(dialog).queryByRole('button', { name: 'Tải thêm người dùng' })).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('Đã hiển thị tối đa 100 người — hãy thu hẹp từ khoá để tìm người còn lại.'),
    ).toBeInTheDocument();
    const userCalls = calls.filter((c) => c.url.startsWith('/api/v1/users') && c.method === 'GET');
    expect(userCalls.length).toBeGreaterThan(0);
    for (const call of userCalls) {
      const pageSize = Number(new URLSearchParams(call.url.split('?')[1] ?? '').get('pageSize'));
      expect(pageSize).toBeLessThanOrEqual(100);
    }
  });
});

describe('Trang vai trò — bảng người dùng kèm vai trò', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function usersCard(): HTMLElement {
    const card = screen.getByText('Tổng số người dùng kèm vai trò của họ').closest('[data-slot="card"]');
    if (!card) throw new Error('Không tìm thấy thẻ bảng người dùng kèm vai trò');
    return card as HTMLElement;
  }

  it('một người dùng một dòng kèm mọi gán và nhãn cấp dạng chữ, trạng thái dạng pill, không cột Plan/Billing và không Export/Import', async () => {
    stubFetch([]);
    renderPage();

    const card = within(usersCard());
    const table = await card.findByRole('table');
    expect(within(table).getByText('An Nguyễn')).toBeInTheDocument();
    expect(within(table).getByText('Bình Trần')).toBeInTheDocument();
    expect(within(table).getByText('Cô Lan')).toBeInTheDocument();
    expect(within(table).getAllByText('Giáo viên')).toHaveLength(2);
    expect(within(table).getByText(/· Hệ thống/)).toBeInTheDocument();
    expect(within(table).getByText(/· Trung tâm/)).toBeInTheDocument();
    expect(screen.queryByText(/thực thể/)).not.toBeInTheDocument();
    expect(within(table).getAllByText('Đang hoạt động')).toHaveLength(2);
    expect(within(table).getByText('Đã khoá')).toBeInTheDocument();
    expect(within(table).queryByText('Plan')).not.toBeInTheDocument();
    expect(within(table).queryByText('Billing')).not.toBeInTheDocument();
    expect(card.queryByText(/Export/)).not.toBeInTheDocument();
    expect(card.queryByText(/Import/)).not.toBeInTheDocument();
    expect(within(table).queryAllByRole('checkbox')).toHaveLength(0);
    expect(card.getByLabelText('Lọc theo vai trò')).toBeInTheDocument();
    expect(card.getByLabelText('Trạng thái')).toBeInTheDocument();
    expect(card.queryByLabelText(/Plan/)).not.toBeInTheDocument();
    expect(card.getByText('Hiển thị 1 đến 3 trong 3 mục')).toBeInTheDocument();
    const pageSizePicker = card.getByLabelText('Số người dùng mỗi trang');
    expect(pageSizePicker).toHaveTextContent('10');
    await userEvent.click(pageSizePicker);
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      '10',
      '25',
      '50',
      '100',
    ]);
    await userEvent.click(screen.getByRole('option', { name: '10' }));
  });

  it('lọc theo vai trò, trạng thái và tìm kiếm đều gửi tham số lên endpoint gộp', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const card = within(usersCard());
    await card.findByText('An Nguyễn');
    const usersCalls = () =>
      calls.filter((c) => c.url.startsWith('/api/v1/access/users-with-assignments') && c.method === 'GET');

    await userEvent.type(card.getByLabelText('Tìm người dùng'), 'binh');
    await waitFor(() => expect(usersCalls().some((c) => c.url.includes('search=binh'))).toBe(true));
    await waitFor(() => expect(card.queryByText('An Nguyễn')).not.toBeInTheDocument());
    expect(card.getByText('Bình Trần')).toBeInTheDocument();

    await chooseOption(card.getByLabelText('Trạng thái'), 'Đã khoá');
    await waitFor(() => expect(usersCalls().some((c) => c.url.includes('status=suspended'))).toBe(true));

    await chooseOption(card.getByLabelText('Lọc theo vai trò'), 'Giáo viên');
    await waitFor(() => expect(usersCalls().some((c) => c.url.includes(`roleId=${ROLE_ID}`))).toBe(true));

    await chooseOption(card.getByLabelText('Số người dùng mỗi trang'), '25');
    await waitFor(() => expect(usersCalls().some((c) => c.url.includes('pageSize=25'))).toBe(true));
  });

  it('hộp thoại quản lý của một dòng liệt kê gán kèm cấp dạng chữ, gán enrol không có nút gỡ mà hiện lý do', async () => {
    stubFetch([]);
    renderPage();

    const card = within(usersCard());
    const table = await card.findByRole('table');
    const manageButtons = within(table).getAllByRole('button', { name: 'Quản lý vai trò' });
    await userEvent.click(manageButtons[1]);
    const dialog = await screen.findByRole('dialog', { name: 'Vai trò của Bình Trần' });
    expect(within(dialog).getByText('Giáo viên')).toBeInTheDocument();
    expect(within(dialog).getByText('Trung tâm')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Gỡ gán' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Không gỡ trực tiếp được — gỡ bằng cách rút ghi danh')).toBeInTheDocument();
  });

  it('gỡ gán tay từ hộp thoại quản lý thì DELETE đúng id; gán thêm mở hộp thoại gán với người dùng chọn sẵn', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const card = within(usersCard());
    const table = await card.findByRole('table');
    const manageButtons = within(table).getAllByRole('button', { name: 'Quản lý vai trò' });
    await userEvent.click(manageButtons[0]);
    const manageDialog = await screen.findByRole('dialog', { name: 'Vai trò của An Nguyễn' });
    await userEvent.click(within(manageDialog).getByRole('button', { name: 'Gỡ gán' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Gỡ gán vai trò' });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Gỡ gán' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === `/api/v1/access/assignments/${ASSIGN_A_ID}` && c.method === 'DELETE'),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gỡ gán vai trò' })).not.toBeInTheDocument());
    const manageDialogAgain = screen.getByRole('dialog', { name: 'Vai trò của An Nguyễn' });
    await userEvent.click(within(manageDialogAgain).getByRole('button', { name: 'Gán thêm vai trò' }));
    const assignDialog = await screen.findByRole('dialog', { name: 'Gán vai trò' });
    expect(within(assignDialog).getByText('Người dùng được gán vai')).toBeInTheDocument();
    expect(within(assignDialog).getByText('annguyen')).toBeInTheDocument();
    expect(within(assignDialog).queryByLabelText('Tìm người dùng')).not.toBeInTheDocument();
  });

  it('đổi tên vai trò thì bảng người dùng kèm vai trò tải lại ngay mà không cần tải lại trang', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const card = within(usersCard());
    await card.findByText('An Nguyễn');
    const usersCalls = () =>
      calls.filter((c) => c.url.startsWith('/api/v1/access/users-with-assignments') && c.method === 'GET');
    const usersBefore = usersCalls().length;
    await userEvent.click(screen.getByRole('button', { name: 'Thao tác với vai trò' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sửa vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sửa vai trò' });
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'course:view' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    await userEvent.clear(within(dialog).getByLabelText('Tên vai trò'));
    await userEvent.type(within(dialog).getByLabelText('Tên vai trò'), 'Giáo viên mới');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/access/roles/${ROLE_ID}` && c.method === 'PATCH')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(usersCalls().length).toBeGreaterThan(usersBefore));
  });

  it('xoá vai trò thì bảng người dùng kèm vai trò tải lại ngay mà không cần tải lại trang', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { roleArchetype: null, roleUserCount: 0 });
    renderPage();

    const card = within(usersCard());
    await card.findByText('An Nguyễn');
    const usersCalls = () =>
      calls.filter((c) => c.url.startsWith('/api/v1/access/users-with-assignments') && c.method === 'GET');
    const usersBefore = usersCalls().length;
    await userEvent.click(screen.getByRole('button', { name: 'Thao tác với vai trò' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Xoá vai trò' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xoá vai trò' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vai trò' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/access/roles/${ROLE_ID}` && c.method === 'DELETE')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(usersCalls().length).toBeGreaterThan(usersBefore));
  });

  it('tạo vai trò thì bảng người dùng kèm vai trò tải lại ngay mà không cần tải lại trang', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const card = within(usersCard());
    await card.findByText('An Nguyễn');
    const usersCalls = () =>
      calls.filter((c) => c.url.startsWith('/api/v1/access/users-with-assignments') && c.method === 'GET');
    const usersBefore = usersCalls().length;
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vai trò mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm vai trò mới' });
    await userEvent.type(within(dialog).getByLabelText('Tên vai trò'), 'Vai trò mới');
    await userEvent.type(within(dialog).getByLabelText('Tên ngắn (shortName)'), 'newrole');
    await chooseOption(within(dialog).getByLabelText('Ngữ cảnh'), 'Hệ thống');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'course:view' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/access/roles' && c.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(usersCalls().length).toBeGreaterThan(usersBefore));
  });

  it('hai gán cùng vai ở hai khoá học hiện nhãn phân biệt ở cột bảng', async () => {
    stubFetch([], { dualCourseAssignments: true });
    renderPage();

    const card = within(usersCard());
    const table = await card.findByRole('table');
    expect(within(table).getByText('· Khoá học')).toBeInTheDocument();
    expect(within(table).getByText('· Khoá học 2')).toBeInTheDocument();
    expect(screen.queryByText(/01900000/)).not.toBeInTheDocument();
  });

  it('hai gán cùng vai ở hai khoá học phân biệt được trong hộp thoại quản lý và xác nhận gỡ', async () => {
    stubFetch([], { dualCourseAssignments: true });
    renderPage();

    const card = within(usersCard());
    const table = await card.findByRole('table');
    const manageButtons = within(table).getAllByRole('button', { name: 'Quản lý vai trò' });
    await userEvent.click(manageButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Vai trò của An Nguyễn' });
    expect(within(dialog).getAllByText('Giáo viên')).toHaveLength(2);
    expect(within(dialog).getByText('Khoá học')).toBeInTheDocument();
    expect(within(dialog).getByText('Khoá học 2')).toBeInTheDocument();
    const unassignButtons = within(dialog).getAllByRole('button', { name: 'Gỡ gán' });
    await userEvent.click(unassignButtons[1]);
    const confirmDialog = await screen.findByRole('dialog', { name: 'Gỡ gán vai trò' });
    expect(within(confirmDialog).getByText(/Khoá học 2/)).toBeInTheDocument();
  });
});
