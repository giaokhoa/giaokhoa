import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';
import { NotificationsPage } from './notifications';

const ITEM_ID = '01900000-0000-7000-8000-0000000000n1'.replace('n', 'a');

function localDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function UnreadBadgeProbe() {
  const query = useQuery({
    queryKey: queryKeys.notificationUnreadCount,
    queryFn: () => apiJson<{ unread: number }>('/api/v1/notifications/unread-count'),
  });
  return <span data-testid="unread-badge">{query.data ? String(query.data.unread) : '…'}</span>;
}

interface CourseOverrideState {
  courseId: string;
  courseName: string;
  mode: 'all' | 'mute';
}

function stubFetch(calls: RecordedCall[], state: { unread: number; allRead: boolean; prefEnabled: boolean; courses: CourseOverrideState[]; minimalPrefs?: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/v1/notifications/unread-count') return respond({ unread: state.unread });
      if (url.startsWith('/api/v1/notifications?')) {
        return respond({
          items: [
            {
              eventType: 'assignment_due',
              component: 'core',
              group: 'learning',
              contextUrl: '/courses/demo',
              day: localDay(new Date()),
              count: 1,
              unreadCount: state.allRead ? 0 : 1,
              latest: {
                id: ITEM_ID,
                subject: 'Bài tập sắp đến hạn',
                smallMessage: 'Nộp trước 23:59',
                contextUrlName: 'Khoá demo',
                createdAt: new Date().toISOString(),
                timeRead: state.allRead ? new Date().toISOString() : null,
              },
            },
          ],
          nextCursor: null,
        });
      }
      if (url === '/api/v1/notifications/mark-read' && method === 'POST') {
        state.allRead = true;
        state.unread = 0;
        return respond({});
      }
      if (url === '/api/v1/messages/preferences' && method === 'GET') {
        if (state.minimalPrefs) return respond([]);
        return respond([
          {
            provider: 'grade_updated', component: 'core_grades', group: 'learning',
            label: { vi: 'Điểm số thay đổi', en: 'Grade updated' },
            description: { vi: 'Khi một mục điểm của bạn được chấm hoặc cập nhật.', en: 'When one of your grade items is graded or updated.' },
            teacherOnly: false, mandatoryInApp: false, popupEnabled: state.prefEnabled, emailFrequency: 'daily', emailAvailable: false,
          },
          {
            provider: 'enrol_expiry_warning', component: 'core_enrol', group: 'learning',
            label: { vi: 'Sắp hết hạn ghi danh', en: 'Enrolment expiring soon' },
            description: { vi: 'Khi thời hạn ghi danh khoá học của bạn sắp hết.', en: 'When your course enrolment is about to expire.' },
            teacherOnly: false, mandatoryInApp: true, popupEnabled: true, emailFrequency: 'daily', emailAvailable: false,
          },
        ]);
      }
      if (url === '/api/v1/messages/preferences' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { provider: string; popupEnabled?: boolean; emailFrequency?: string };
        if (body.provider === 'grade_updated' && body.popupEnabled !== undefined) state.prefEnabled = body.popupEnabled;
        return respond({
          provider: body.provider, component: 'core_grades', group: 'learning',
          label: { vi: 'Điểm số thay đổi', en: 'Grade updated' },
          description: { vi: 'Khi một mục điểm của bạn được chấm hoặc cập nhật.', en: 'When one of your grade items is graded or updated.' },
          teacherOnly: false, mandatoryInApp: false,
          popupEnabled: body.provider === 'grade_updated' ? state.prefEnabled : true,
          emailFrequency: body.emailFrequency ?? 'daily', emailAvailable: false,
        });
      }
      if (url === '/api/v1/messages/preferences/courses' && method === 'GET') {
        return respond({ courses: state.courses });
      }
      if (url === '/api/v1/messages/preferences/courses' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { courseId: string; mode: 'all' | 'mute' };
        const row = state.courses.find((c) => c.courseId === body.courseId);
        if (row) row.mode = body.mode;
        return respond(row ?? { courseId: body.courseId, courseName: '', mode: body.mode });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/notifications', element: <NotificationsPage /> }], {
    initialEntries: ['/notifications'],
  });
  render(
    <TestProviders>
      <UnreadBadgeProbe />
      <RouterProvider router={router} />
    </TestProviders>,
  );
}

describe('Trang thông báo — vô hiệu TanStack (F-01)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('đánh dấu-tất-cả-đã-đọc vô hiệu query số chưa đọc dùng chung để huy hiệu về 0', async () => {
    const calls: RecordedCall[] = [];
    const state = { unread: 3, allRead: false, prefEnabled: true, courses: [] as CourseOverrideState[] };
    stubFetch(calls, state);
    renderPage();

    await screen.findByTestId('unread-badge');
    await waitFor(() => expect(screen.getByTestId('unread-badge')).toHaveTextContent('3'));
    expect(await screen.findByText('Bài tập sắp đến hạn')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã đọc tất cả' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/notifications/mark-read' && c.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId('unread-badge')).toHaveTextContent('0'));
    expect(
      calls.filter((c) => c.url === '/api/v1/notifications/unread-count' && c.method === 'GET').length,
    ).toBeGreaterThan(1);
  });

  it('chỉ trung tâm sau #288: không có UI tuỳ chọn ở đây và không gọi API tuỳ chọn', async () => {
    const calls: RecordedCall[] = [];
    const state = { unread: 0, allRead: true, prefEnabled: true, courses: [] as CourseOverrideState[] };
    stubFetch(calls, state);
    renderPage();

    expect(await screen.findByText('Bài tập sắp đến hạn')).toBeInTheDocument();
    expect(screen.queryByText('Tuỳ chọn thông báo')).not.toBeInTheDocument();
    expect(screen.queryByText('Ngoại lệ theo khoá học')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/v1/messages/preferences'))).toBe(false);
  });
});
