import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
import { stubFetchWithMethod as stubFetch, type RecordedCall } from '#test/stub-fetch';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';
import { NotificationsPage } from './notifications';

/**
 * Spec F-01 cho trang thông báo: điểm hợp nhất cốt lõi là các thao tác đọc ở trang này phải LÀM MỚI khoá `notificationUnreadCount` dùng chung với huy hiệu chuông ở sidebar/header (trước đây trang fetch thủ công không hề invalidate nên huy hiệu giữ số cũ). Probe dưới đây đóng vai huy hiệu: một useQuery độc lập cùng khoá factory + cùng endpoint như app-sidebar.
 */
const ITEM_ID = '01900000-0000-7000-8000-0000000000n1'.replace('n', 'a');

function localDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** Huy hiệu chưa đọc mô phỏng sidebar: query độc lập, cùng khoá + endpoint thật. */
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

function stubNotificationsFetch(calls: RecordedCall[], state: { unread: number; allRead: boolean; prefEnabled: boolean; courses: CourseOverrideState[]; minimalPrefs?: boolean }) {
  stubFetch((url, method, body) => {
    if (url === '/api/v1/notifications/unread-count') return ({ unread: state.unread });
    if (url.startsWith('/api/v1/notifications?')) {
      return ({
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
      return ({});
    }
    if (url === '/api/v1/messages/preferences' && method === 'GET') {
      // NB-7: học sinh nhận danh sách rỗng (phần tối thiểu).
      if (state.minimalPrefs) return [];
      // Mô hình v2 (NB-2): một dòng mỗi provider, nhãn từ registry.
      return [
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
      ];
    }
    if (url === '/api/v1/messages/preferences' && method === 'PUT') {
      const requestBody = body as { provider: string; popupEnabled?: boolean; emailFrequency?: string };
      if (requestBody.provider === 'grade_updated' && requestBody.popupEnabled !== undefined) state.prefEnabled = requestBody.popupEnabled;
      return ({
        provider: requestBody.provider, component: 'core_grades', group: 'learning',
        label: { vi: 'Điểm số thay đổi', en: 'Grade updated' },
        description: { vi: 'Khi một mục điểm của bạn được chấm hoặc cập nhật.', en: 'When one of your grade items is graded or updated.' },
        teacherOnly: false, mandatoryInApp: false,
        popupEnabled: requestBody.provider === 'grade_updated' ? state.prefEnabled : true,
        emailFrequency: requestBody.emailFrequency ?? 'daily', emailAvailable: false,
      });
    }
    if (url === '/api/v1/messages/preferences/courses' && method === 'GET') {
      // Ghi đè theo khoá (NB-4): mọi khoá thuộc về kèm chế độ hiệu lực.
      return ({ courses: state.courses });
    }
    if (url === '/api/v1/messages/preferences/courses' && method === 'PUT') {
      const requestBody = body as { courseId: string; mode: 'all' | 'mute' };
      const row = state.courses.find((c) => c.courseId === requestBody.courseId);
      if (row) row.mode = requestBody.mode;
      return row ?? { courseId: requestBody.courseId, courseName: '', mode: requestBody.mode };
    }
    return undefined;
  }, calls);
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
    stubNotificationsFetch(calls, state);
    renderPage();

    await screen.findByTestId('unread-badge');
    await waitFor(() => expect(screen.getByTestId('unread-badge')).toHaveTextContent('3'));
    expect(await screen.findByText('Bài tập sắp đến hạn')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã đọc tất cả' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/notifications/mark-read' && c.method === 'POST')).toBe(true),
    );
    // Huy hiệu (query độc lập cùng khoá) chỉ về 0 được nếu mutation đã
    // invalidate đúng khoá factory — đây là hành vi F-01 thêm vào.
    await waitFor(() => expect(screen.getByTestId('unread-badge')).toHaveTextContent('0'));
    expect(
      calls.filter((c) => c.url === '/api/v1/notifications/unread-count' && c.method === 'GET').length,
    ).toBeGreaterThan(1);
  });

  it('chỉ trung tâm sau #288: không có UI tuỳ chọn ở đây và không gọi API tuỳ chọn', async () => {
    const calls: RecordedCall[] = [];
    const state = { unread: 0, allRead: true, prefEnabled: true, courses: [] as CourseOverrideState[] };
    stubNotificationsFetch(calls, state);
    renderPage();

    // Trung tâm vẫn hiện danh sách thông báo như cũ.
    expect(await screen.findByText('Bài tập sắp đến hạn')).toBeInTheDocument();
    // Tuỳ chọn + ngoại lệ theo khoá đã chuyển hẳn sang /settings/notifications.
    expect(screen.queryByText('Tuỳ chọn thông báo')).not.toBeInTheDocument();
    expect(screen.queryByText('Ngoại lệ theo khoá học')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/v1/messages/preferences'))).toBe(false);
  });
});
