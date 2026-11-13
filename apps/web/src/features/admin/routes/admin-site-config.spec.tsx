import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteSetting } from '@giaokhoa/contracts';
import { TestProviders } from '#test/providers';
import { AdminSiteConfigPage } from './admin-site-config';

const SETTINGS: SiteSetting[] = [
  {
    component: 'core',
    name: 'messagingallusers',
    type: 'boolean',
    defaultValue: false,
    value: false,
    source: 'default',
    scope: 'platform',
  },
  {
    component: 'core',
    name: 'fullname',
    type: 'string',
    defaultValue: 'Giáo khoa',
    value: 'Giáo khoa Trường tôi',
    source: 'database',
    scope: 'both',
  },
  { component: 'core', name: 'lang', type: 'enum', defaultValue: 'vi', value: 'vi', source: 'default', scope: 'both' },
];

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(calls: RecordedCall[], settings: SiteSetting[] = SETTINGS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/v1/site-config' && method === 'GET') return respond(settings);
      if (url === '/api/v1/site-config/audit') return respond([]);
      if (url.startsWith('/api/v1/site-config/')) return respond(settings[0]);
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/admin/site-config', element: <AdminSiteConfigPage /> }], {
    initialEntries: ['/admin/site-config'],
  });
  render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
}

describe('Trang cấu hình site của admin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('render cài đặt từ stub nhóm theo component kèm huy hiệu nguồn', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    expect(await screen.findByText('messagingallusers')).toBeInTheDocument();
    expect(screen.getByText('fullname')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Giáo khoa Trường tôi')).toBeInTheDocument();
    expect(screen.getAllByText('mặc định').length).toBeGreaterThan(0);
    expect(screen.getByText('đã ghi đè')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/v1/site-config' && c.method === 'GET')).toBe(true);
  });

  it('lưu boolean qua PUT { value: true } tới đúng URL cài đặt', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const checkbox = await screen.findByRole('checkbox', { name: 'Giá trị của core/messagingallusers' });
    await userEvent.click(checkbox);
    const row = checkbox.closest('li');
    expect(row).not.toBeNull();
    const saveByText = [...row!.querySelectorAll('button')].find((b) => b.textContent === 'Lưu');
    expect(saveByText).toBeTruthy();
    await userEvent.click(saveByText!);

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/v1/site-config/core/messagingallusers');
    expect(put?.body).toEqual({ value: true });
  });

  it('render mục chính sách thông báo kèm nhãn provider và loại bắt buộc bị khoá (NB-7)', async () => {
    const calls: RecordedCall[] = [];
    const notifSettings: SiteSetting[] = [
      {
        component: 'notifications', name: 'provider_grade_updated_enabled', type: 'boolean',
        defaultValue: true, value: true, source: 'default', scope: 'platform',
      },
      {
        component: 'notifications', name: 'provider_enrol_expiry_warning_enabled', type: 'boolean',
        defaultValue: true, value: true, source: 'default', scope: 'platform',
      },
    ];
    stubFetch(calls, notifSettings);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Thông báo' })).toBeInTheDocument();
    expect(screen.getByText('Điểm số thay đổi')).toBeInTheDocument();
    expect(screen.getByText('Sắp hết hạn ghi danh')).toBeInTheDocument();
    expect(screen.getByText('Loại bắt buộc — không tắt được')).toBeInTheDocument();
    const mandatoryBox = screen.getByRole('checkbox', { name: 'Giá trị của notifications/provider_enrol_expiry_warning_enabled' });
    expect(mandatoryBox).toHaveAttribute('aria-disabled', 'true');
    expect(mandatoryBox).toHaveAttribute('data-disabled');
    expect(mandatoryBox).toHaveAttribute('aria-checked', 'true');

    const box = screen.getByRole('checkbox', { name: 'Giá trị của notifications/provider_grade_updated_enabled' });
    expect(box).not.toBeDisabled();
    await userEvent.click(box);
    const row = box.closest('li');
    const saveByText = [...row!.querySelectorAll('button')].find((b) => b.textContent === 'Lưu');
    await userEvent.click(saveByText!);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/v1/site-config/notifications/provider_grade_updated_enabled');
    expect(put?.body).toEqual({ value: false });
  });

  it('đặt lại cài đặt đã ghi đè qua DELETE tới đúng URL cài đặt', async () => {
    const calls: RecordedCall[] = [];
    stubFetch(calls);
    renderPage();

    const resetButton = await screen.findByRole('button', { name: 'Đặt lại' });
    await userEvent.click(resetButton);

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('/api/v1/site-config/core/fullname');
  });
});
