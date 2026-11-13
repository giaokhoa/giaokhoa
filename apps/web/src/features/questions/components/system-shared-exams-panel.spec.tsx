import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#config/i18n';
import { TestProviders } from '#test/providers';
import { baSessionBody, isGetSessionUrl } from '#test/ba-session';
import { SystemSharedExamsPanel } from './system-shared-exams-panel';

const USER_ID = '01900000-0000-7000-8000-000000000091';
const COURSE_ID = '01900000-0000-7000-8000-000000000092';
const SECTION_ID = '01900000-0000-7000-8000-000000000093';
const SHARED_ID = '01900000-0000-7000-8000-000000000094';
const PIN_ID = '01900000-0000-7000-8000-000000000095';
const SYSTEM_CONTEXT = '01900000-0000-7000-8000-000000000096';

describe('Giao đề chung từ giao diện', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('chỉ chọn phiên bản đã duyệt, truyền requestId, mục và lịch khi tạo đợt giao', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ url, method, body });
      const respond = (value: unknown) => new Response(JSON.stringify(value), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
      if (isGetSessionUrl(url)) return respond(baSessionBody({ id: USER_ID, username: 'manager', email: 'manager@example.com' }));
      if (url === '/api/v1/users/me') {
        return respond({ id: USER_ID, username: 'manager', firstName: 'Quản', lastName: 'Trị',
          email: 'manager@example.com', suspended: false, deleted: false, isGuest: false,
          forcePasswordChange: false, lastLogin: null, createdAt: '2026-01-01T00:00:00.000Z', customFields: [] });
      }
      if (url === '/api/v1/users/me/capabilities') {
        return respond({ userId: USER_ID, isSiteAdmin: true, assignments: [], contexts: [{
          contextId: SYSTEM_CONTEXT, contextLevel: 10, instanceId: SYSTEM_CONTEXT,
          capabilities: ['systembank:review'],
        }] });
      }
      if (url === '/api/v1/courses') return respond([{ id: COURSE_ID, fullName: 'Lớp A', shortName: 'a' }]);
      if (url === `/api/v1/courses/${COURSE_ID}/content`) return respond({
        sections: [{ id: SECTION_ID, name: 'Chủ đề 1' }], modules: [],
      });
      if (url === `/api/v1/courses/${COURSE_ID}/groups`) return respond([]);
      if (url === `/api/v1/system-bank/exams?courseId=${COURSE_ID}`) {
        return respond([{ id: SHARED_ID, name: 'Đề liên trung tâm', sourceExamId: SHARED_ID,
          sourceVersionNumber: 3, grade: null, examKind: 'practice', totalScore: 10,
          durationMinutes: 45, slotCount: 4, status: 'approved', createdAt: '2026-11-13T00:00:00Z',
          rejectionReason: null }]);
      }
      if (url === '/api/v1/system-bank/exams/pending') return respond([]);
      if (url === `/api/v1/courses/${COURSE_ID}/exam-pins` && method === 'POST') return respond({ id: PIN_ID });
      return respond([]);
    }));
    const router = createMemoryRouter([
      { path: '/system-bank/exams', element: <SystemSharedExamsPanel /> },
      { path: '/courses/:courseId/exams/:pinId', element: <div>Đã giao đề</div> },
    ], { initialEntries: ['/system-bank/exams'] });
    const { container } = render(<TestProviders><RouterProvider router={router} /></TestProviders>);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Đề chung hệ thống đã duyệt' });
    await waitFor(() => expect(container.querySelector('#shared-exam-course option[value="' + COURSE_ID + '"]')).not.toBeNull());
    await user.selectOptions(container.querySelector('#shared-exam-course') as HTMLSelectElement, COURSE_ID);
    await screen.findByRole('option', { name: /Đề liên trung tâm/ });
    await user.selectOptions(container.querySelector('#shared-exam-version') as HTMLSelectElement, SHARED_ID);
    await waitFor(() => expect(container.querySelector('#shared-exam-section option[value="' + SECTION_ID + '"]')).not.toBeNull());
    await user.selectOptions(container.querySelector('#shared-exam-section') as HTMLSelectElement, SECTION_ID);
    await user.type(screen.getByLabelText('Tên đợt giao (tuỳ chọn)'), 'Đợt thi riêng A');
    await user.click(screen.getByRole('button', { name: 'Giao đề chung' }));
    await screen.findByText('Đã giao đề');
    const assigned = calls.find((call) => call.url === `/api/v1/courses/${COURSE_ID}/exam-pins` && call.method === 'POST');
    expect(assigned?.body).toMatchObject({
      sharedExamVersionId: SHARED_ID, sectionId: SECTION_ID, name: 'Đợt thi riêng A', variantCount: 1,
    });
    expect(assigned?.body?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(assigned?.body?.examId).toBeUndefined();
  });
});
