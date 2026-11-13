import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '#lib/query-client';
import { SettingsNotificationsPage } from './settings-notifications';

interface PrefRow {
  provider: string;
  component: string;
  group: 'learning' | 'people' | 'system';
  label: { vi: string; en: string };
  description: { vi: string; en: string };
  teacherOnly: boolean;
  mandatoryInApp: boolean;
  popupEnabled: boolean;
  emailFrequency: 'immediate' | 'daily' | 'off' | null;
  emailAvailable: boolean;
  siteEnabled: boolean;
}

interface CourseOverrideState {
  courseId: string;
  courseName: string;
  mode: 'all' | 'mute';
}

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function row(partial: Partial<PrefRow> & Pick<PrefRow, 'provider' | 'group' | 'label'>): PrefRow {
  return {
    component: 'core',
    description: { vi: 'Mô tả loại.', en: 'Type description.' },
    teacherOnly: false,
    mandatoryInApp: false,
    popupEnabled: true,
    emailFrequency: 'daily',
    emailAvailable: false,
    siteEnabled: true,
    ...partial,
  } as PrefRow;
}

function teacherRows(): PrefRow[] {
  return [
    row({ provider: 'grade_updated', group: 'learning', label: { vi: 'Điểm số thay đổi', en: 'Grade updated' }, emailFrequency: 'daily' }),
    row({ provider: 'assignment_submitted', group: 'learning', label: { vi: 'Bài nộp mới', en: 'New submission' }, teacherOnly: true, emailFrequency: 'daily' }),
    row({ provider: 'enrol_expiry_warning', group: 'learning', label: { vi: 'Sắp hết hạn ghi danh', en: 'Enrolment expiring' }, mandatoryInApp: true, emailFrequency: 'daily' }),
    row({ provider: 'message_new', group: 'people', label: { vi: 'Tin nhắn mới', en: 'New message' }, emailFrequency: 'immediate' }),
    row({ provider: 'badge_awarded', group: 'people', label: { vi: 'Huy hiệu mới', en: 'New badge' }, popupEnabled: false, emailFrequency: 'immediate', siteEnabled: false }),
    row({ provider: 'calendar_reminder', group: 'system', label: { vi: 'Nhắc sự kiện lịch', en: 'Calendar reminder' }, emailFrequency: 'immediate' }),
  ];
}

function stubFetch(calls: RecordedCall[], state: { rows: PrefRow[]; courses: CourseOverrideState[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/v1/messages/preferences' && method === 'GET') return respond(state.rows);
      if (url === '/api/v1/messages/preferences' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { provider: string; popupEnabled?: boolean; emailFrequency?: PrefRow['emailFrequency'] };
        const target = state.rows.find((r) => r.provider === body.provider);
        if (!target) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
        if (body.popupEnabled !== undefined) target.popupEnabled = body.popupEnabled;
        if (body.emailFrequency !== undefined) target.emailFrequency = body.emailFrequency;
        return respond(target);
      }
      if (url === '/api/v1/messages/preferences/courses' && method === 'GET') return respond({ courses: state.courses });
      if (url === '/api/v1/messages/preferences/courses' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { courseId: string; mode: 'all' | 'mute' };
        const target = state.courses.find((c) => c.courseId === body.courseId);
        if (target) target.mode = body.mode;
        return respond(target ?? { courseId: body.courseId, courseName: '', mode: body.mode });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/settings/notifications', element: <SettingsNotificationsPage /> }], {
    initialEntries: ['/settings/notifications'],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function prefPuts(calls: RecordedCall[]) {
  return calls.filter((c) => c.url === '/api/v1/messages/preferences' && c.method === 'PUT');
}

describe('Cài đặt — tuỳ chọn thông báo, mô hình hai lớp (#288)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lớp 1 hiện trạng thái nhóm suy từ dòng thật; bảng theo loại vẫn gập', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { rows: teacherRows(), courses: [] });
    renderPage();

    const learningPopup = await screen.findByLabelText('Học tập — Trong ứng dụng');
    expect(learningPopup).toBeChecked();
    expect(screen.getByLabelText('Học tập — Email')).toHaveValue('daily');
    expect(screen.getByLabelText('Lớp & mọi người — Trong ứng dụng')).toBeChecked();
    expect(screen.getByLabelText('Lớp & mọi người — Email')).toHaveValue('immediate');
    expect(screen.getByLabelText('Hệ thống — Email')).toHaveValue('immediate');
    expect(screen.getByText('Nhóm này gồm loại bắt buộc luôn hiện trong ứng dụng, không tắt được.')).toBeInTheDocument();
    expect(screen.queryByText('Điểm số thay đổi')).not.toBeInTheDocument();
    expect(screen.getByText('Tuỳ chỉnh từng loại')).toBeInTheDocument();
  });

  it('nhóm bị bộ lọc audience của API làm rỗng thì không render mục nào ở cả hai lớp (issue #288)', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, {
      rows: [
        row({ provider: 'message_new', group: 'people', label: { vi: 'Tin nhắn mới', en: 'New message' }, emailFrequency: 'immediate' }),
        row({ provider: 'badge_awarded', group: 'people', label: { vi: 'Huy hiệu mới', en: 'New badge' }, emailFrequency: 'immediate' }),
      ],
      courses: [],
    });
    renderPage();

    expect(await screen.findByLabelText('Lớp & mọi người — Trong ứng dụng')).toBeInTheDocument();
    expect(screen.queryByLabelText('Học tập — Trong ứng dụng')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hệ thống — Trong ứng dụng')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Tuỳ chỉnh từng loại'));
    expect(await screen.findByLabelText('Tin nhắn mới — Trong ứng dụng')).toBeInTheDocument();
    expect(screen.queryByText('Học tập', { selector: 'h3' })).not.toBeInTheDocument();
    expect(screen.queryByText('Hệ thống', { selector: 'h3' })).not.toBeInTheDocument();
  });

  it('tắt popup của nhóm sẽ PUT mọi provider trong nhóm trừ loại bắt buộc', async () => {
    const calls: RecordedCall[] = [];
    const state = { rows: teacherRows(), courses: [] as CourseOverrideState[] };
    stubFetch(calls, state);
    renderPage();

    const learningPopup = await screen.findByLabelText('Học tập — Trong ứng dụng');
    await userEvent.click(learningPopup);

    await waitFor(() => expect(prefPuts(calls)).toHaveLength(2));
    expect(prefPuts(calls).map((c) => c.body)).toEqual([
      { provider: 'grade_updated', popupEnabled: false },
      { provider: 'assignment_submitted', popupEnabled: false },
    ]);
    await waitFor(() => expect((screen.getByLabelText('Học tập — Trong ứng dụng') as HTMLInputElement).indeterminate).toBe(true));
    expect(screen.getByText(/Các loại trong nhóm đang có giá trị khác nhau/)).toBeInTheDocument();
  });

  it('đổi tần suất email của nhóm sẽ PUT tần suất cho mọi provider trong nhóm', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { rows: teacherRows(), courses: [] });
    renderPage();

    const learningEmail = await screen.findByLabelText('Học tập — Email');
    await userEvent.selectOptions(learningEmail, 'immediate');

    await waitFor(() => expect(prefPuts(calls)).toHaveLength(3));
    expect(prefPuts(calls).map((c) => c.body)).toEqual([
      { provider: 'grade_updated', emailFrequency: 'immediate' },
      { provider: 'assignment_submitted', emailFrequency: 'immediate' },
      { provider: 'enrol_expiry_warning', emailFrequency: 'immediate' },
    ]);
    await waitFor(() => expect(screen.getByLabelText('Học tập — Email')).toHaveValue('immediate'));
  });

  it('thay đổi theo loại sẽ PUT đúng một provider và thắng cài đặt nhóm', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { rows: teacherRows(), courses: [] });
    renderPage();

    await screen.findByLabelText('Học tập — Trong ứng dụng');
    await userEvent.click(screen.getByText('Tuỳ chỉnh từng loại'));
    const typePopup = await screen.findByLabelText('Điểm số thay đổi — Trong ứng dụng');
    expect(typePopup).toBeChecked();
    await userEvent.click(typePopup);

    await waitFor(() => expect(prefPuts(calls)).toHaveLength(1));
    expect(prefPuts(calls)[0]!.body).toEqual({ provider: 'grade_updated', popupEnabled: false });
    await waitFor(() => expect((screen.getByLabelText('Học tập — Trong ứng dụng') as HTMLInputElement).indeterminate).toBe(true));
    expect(screen.getByLabelText('Điểm số thay đổi — Trong ứng dụng')).not.toBeChecked();
    expect(screen.getByLabelText('Bài nộp mới — Trong ứng dụng')).toBeChecked();
  });

  it('loại bắt buộc vẫn khoá bật ở lớp 2 kèm huy hiệu Required (P2)', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { rows: teacherRows(), courses: [] });
    renderPage();

    await screen.findByLabelText('Học tập — Trong ứng dụng');
    await userEvent.click(screen.getByText('Tuỳ chỉnh từng loại'));
    const mandatoryToggle = await screen.findByLabelText('Sắp hết hạn ghi danh — Trong ứng dụng');
    expect(mandatoryToggle).toBeChecked();
    expect(mandatoryToggle).toBeDisabled();
    expect(screen.getByText('Bắt buộc')).toBeInTheDocument();
    expect(screen.getByLabelText('Sắp hết hạn ghi danh — Email')).not.toBeDisabled();
  });

  it('loại admin đã tắt hiện huy hiệu site-off, khoá điều khiển, và ghi nhóm bỏ qua nó (NB-7)', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, { rows: teacherRows(), courses: [] });
    renderPage();

    await screen.findByLabelText('Lớp & mọi người — Trong ứng dụng');
    await userEvent.click(screen.getByText('Tuỳ chỉnh từng loại'));
    expect(await screen.findByText('Admin đã tắt ở cấp site')).toBeInTheDocument();
    expect(screen.getByText(/Quản trị đã tắt loại này cho toàn hệ thống/)).toBeInTheDocument();
    expect(screen.getByLabelText('Huy hiệu mới — Trong ứng dụng')).toBeDisabled();
    expect(screen.getByLabelText('Huy hiệu mới — Email')).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Lớp & mọi người — Trong ứng dụng'));
    await waitFor(() => expect(prefPuts(calls)).toHaveLength(1));
    expect(prefPuts(calls)[0]!.body).toEqual({ provider: 'message_new', popupEnabled: false });
  });

  it('ngoại lệ khoá học vẫn chạy trên trang này: danh sách, huy hiệu tắt tiếng, bật/tắt PUT chế độ mới (NB-4/P3)', async () => {
    const calls: RecordedCall[] = [];
    const state = {
      rows: teacherRows(),
      courses: [
        { courseId: 'course-1', courseName: 'Khoá Toán 10', mode: 'all' as const },
        { courseId: 'course-2', courseName: 'Khoá Văn 10', mode: 'mute' as const },
      ],
    };
    stubFetch(calls, state);
    renderPage();

    expect(await screen.findByText('Ngoại lệ theo khoá học')).toBeInTheDocument();
    expect(await screen.findByText('Khoá Toán 10')).toBeInTheDocument();
    expect(screen.getByText('Đã tắt tiếng')).toBeInTheDocument();
    expect(screen.getByText(/Điểm mới và thông báo sắp hết hạn ghi danh/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Tắt tiếng khoá này: Khoá Toán 10'));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/messages/preferences/courses' && c.method === 'PUT')).toBe(true),
    );
    const put = calls.find((c) => c.url === '/api/v1/messages/preferences/courses' && c.method === 'PUT');
    expect(put?.body).toEqual({ courseId: 'course-1', mode: 'mute' });
    await waitFor(() => expect(screen.getAllByText('Đã tắt tiếng')).toHaveLength(2));
  });

  it('bề mặt tối thiểu của học viên: không dòng nhóm, không lớp theo loại, ngoại lệ khoá học vẫn còn (NB-7)', async () => {
    const calls: RecordedCall[] = [];
    const state = {
      rows: [] as PrefRow[],
      courses: [{ courseId: 'course-1', courseName: 'Khoá Toán 10', mode: 'all' as const }],
    };
    stubFetch(calls, state);
    renderPage();

    expect(
      await screen.findByText('Tài khoản học sinh chỉ tuỳ chỉnh được thông báo theo từng khoá học ở mục Ngoại lệ theo khoá học bên dưới.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Tuỳ chỉnh từng loại')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Học tập — Trong ứng dụng')).not.toBeInTheDocument();
    expect(await screen.findByText('Ngoại lệ theo khoá học')).toBeInTheDocument();
    expect(screen.getByLabelText('Tắt tiếng khoá này: Khoá Toán 10')).toBeInTheDocument();
  });

  it('đổi tần suất email của một loại ở lớp tuỳ chỉnh: chỉ PUT đúng provider đó, hiện ghi chú kênh chưa khả dụng', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls, {
      rows: [
        row({ provider: 'badge_awarded', group: 'people', label: { vi: 'Huy hiệu mới', en: 'New badge' }, emailFrequency: 'immediate' }),
      ],
      courses: [],
    });
    renderPage();

    await screen.findByLabelText('Lớp & mọi người — Trong ứng dụng');
    await userEvent.click(screen.getByText('Tuỳ chỉnh từng loại'));
    expect(await screen.findByText('Huy hiệu mới')).toBeInTheDocument();
    expect(screen.queryByText('badge_awarded')).not.toBeInTheDocument();
    expect(screen.queryByText(/loggedin|loggedoff/)).not.toBeInTheDocument();
    const select = await screen.findByLabelText('Huy hiệu mới — Email');
    expect(select).toHaveValue('immediate');
    expect(screen.getByText('Chưa khả dụng — cài đặt sẽ áp dụng khi kênh mở')).toBeInTheDocument();
    expect(screen.queryByText(/push/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(select, 'off');
    await waitFor(() => expect(prefPuts(calls)).toHaveLength(1));
    expect(prefPuts(calls)[0]!.body).toEqual({ provider: 'badge_awarded', emailFrequency: 'off' });
    await waitFor(() => expect(screen.getByLabelText('Huy hiệu mới — Email')).toHaveValue('off'));
  });

  it('PUT tuỳ chọn thất bại: công tắc hoàn về trạng thái cũ và hiện cảnh báo lỗi', async () => {
    const badgeRow = row({
      provider: 'badge_awarded', group: 'people', label: { vi: 'Huy hiệu mới', en: 'New badge' }, emailFrequency: 'immediate',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/v1/messages/preferences' && init?.method === 'PUT')
          return new Response(
            JSON.stringify({ type: 'about:blank', title: 'Bad Request', status: 400, code: 'messaging.unknown_provider' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        if (url === '/api/v1/messages/preferences')
          return new Response(JSON.stringify([badgeRow]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url === '/api/v1/messages/preferences/courses')
          return new Response(JSON.stringify({ courses: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    renderPage();

    await screen.findByLabelText('Lớp & mọi người — Trong ứng dụng');
    await userEvent.click(screen.getByText('Tuỳ chỉnh từng loại'));
    const toggle = await screen.findByLabelText('Huy hiệu mới — Trong ứng dụng');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được tuỳ chọn thông báo');
    expect(toggle).toBeChecked();
    expect(toggle).not.toBeDisabled();
  });
});
