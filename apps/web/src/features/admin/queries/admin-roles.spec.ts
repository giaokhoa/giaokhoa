import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useCapabilityMatrix,
  useCreateRole,
  useDeleteRole,
  usersWithAssignmentsQueryOptions,
  useUpdateRole,
} from './admin-roles';

const ROLE_ID = '01900000-0000-7000-8000-0000000000b1';
const SYSTEM_CONTEXT_ID = '01900000-0000-7000-8000-000000000010';

interface RecordedCall {
  url: string;
  method: string;
}

function stubFetch(calls: RecordedCall[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const respond = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/api/v1/access/capability-matrix') && method === 'GET')
        return respond({ contextId: SYSTEM_CONTEXT_ID, roles: [] });
      if (url.startsWith('/api/v1/access/users-with-assignments') && method === 'GET')
        return respond({ users: [], total: 0, page: 1, pageSize: 10 });
      if (url === '/api/v1/access/roles' && method === 'POST')
        return respond({ id: ROLE_ID, name: 'Vai trò mới', shortName: 'newrole' });
      if (url === `/api/v1/access/roles/${ROLE_ID}` && method === 'PATCH') return respond({});
      if (url === `/api/v1/access/roles/${ROLE_ID}` && method === 'DELETE') return respond({ deleted: true });
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return client;
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

async function seedQueries(client: QueryClient, calls: RecordedCall[]) {
  const wrap = wrapper(client);
  renderHook(() => useCapabilityMatrix(SYSTEM_CONTEXT_ID), { wrapper: wrap });
  renderHook(() => useQuery(usersWithAssignmentsQueryOptions({ page: 1, pageSize: 10 })), {
    wrapper: wrap,
  });
  await waitFor(() => expect(countCalls(calls, '/api/v1/access/capability-matrix')).toBe(1));
  await waitFor(() => expect(countCalls(calls, '/api/v1/access/users-with-assignments')).toBe(1));
}

function countCalls(calls: RecordedCall[], prefix: string) {
  return calls.filter((call) => call.url.startsWith(prefix) && call.method === 'GET').length;
}

describe('Đột biến vai trò — làm mới bảng người dùng kèm vai trò và ma trận toàn trang', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('đổi tên vai trò làm mới cả bảng người dùng kèm vai trò lẫn ma trận toàn trang', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    const client = createClient();
    await seedQueries(client, calls);
    const matrixBefore = countCalls(calls, '/api/v1/access/capability-matrix');
    const usersBefore = countCalls(calls, '/api/v1/access/users-with-assignments');

    const { result } = renderHook(() => useUpdateRole(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ roleId: ROLE_ID, draft: { name: 'Giáo viên mới', description: '' } });

    await waitFor(() =>
      expect(countCalls(calls, '/api/v1/access/users-with-assignments')).toBeGreaterThan(usersBefore),
    );
    await waitFor(() =>
      expect(countCalls(calls, '/api/v1/access/capability-matrix')).toBeGreaterThan(matrixBefore),
    );
  });

  it('tạo vai trò làm mới cả bảng người dùng kèm vai trò lẫn ma trận toàn trang', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    const client = createClient();
    await seedQueries(client, calls);
    const matrixBefore = countCalls(calls, '/api/v1/access/capability-matrix');
    const usersBefore = countCalls(calls, '/api/v1/access/users-with-assignments');

    const { result } = renderHook(() => useCreateRole(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ name: 'Vai trò mới', shortName: 'newrole' });

    await waitFor(() =>
      expect(countCalls(calls, '/api/v1/access/users-with-assignments')).toBeGreaterThan(usersBefore),
    );
    await waitFor(() =>
      expect(countCalls(calls, '/api/v1/access/capability-matrix')).toBeGreaterThan(matrixBefore),
    );
  });

  it('xoá vai trò làm mới cả bảng người dùng kèm vai trò lẫn ma trận toàn trang', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    const client = createClient();
    await seedQueries(client, calls);
    const matrixBefore = countCalls(calls, '/api/v1/access/capability-matrix');
    const usersBefore = countCalls(calls, '/api/v1/access/users-with-assignments');

    const { result } = renderHook(() => useDeleteRole(), { wrapper: wrapper(client) });
    await result.current.mutateAsync(ROLE_ID);

    await waitFor(() =>
      expect(countCalls(calls, '/api/v1/access/users-with-assignments')).toBeGreaterThan(usersBefore),
    );
    await waitFor(() =>
      expect(countCalls(calls, '/api/v1/access/capability-matrix')).toBeGreaterThan(matrixBefore),
    );
  });
});
