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

  it('người duyệt xem đủ cấu hình đề, bốn dạng câu, khoá đáp án, hướng dẫn và media trước khi duyệt', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const document = (value: string) => ({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
    });
    const imageHash = 'a'.repeat(64);
    const base = {
      generalFeedback: document('Phản hồi chung của câu hỏi'),
      stimulusContent: document('Ngữ liệu dùng chung'),
      answers: [],
      answerKey: null,
      options: null,
      outcomes: [{ outcomeId: SHARED_ID, cognitiveLevel: 'apply' }],
      media: [],
    };
    const slots = [
      {
        qtype: 'multichoice', package: {
          ...base,
          questionText: { type: 'doc', content: [...document('Câu hỏi chọn đáp án').content, {
            type: 'image', attrs: { src: `bank-media://${imageHash}`, alt: 'Ảnh câu hỏi' },
          }] },
          answers: ['Đáp án đúng A', 'Đáp án sai B', 'Đáp án sai C', 'Đáp án sai D'].map((answer, i) => ({
            answer: document(answer), isCorrect: i === 0, feedback: document(`Giải thích ${i}`), sortOrder: i,
          })),
          media: [{ contentHash: imageHash, fileName: 'anh-cau-hoi.png', mimeType: 'image/png' }],
        },
      },
      {
        qtype: 'truefalse', package: {
          ...base, questionText: document('Câu hỏi đúng sai'),
          answerKey: { guidance: document('Hướng dẫn đúng sai'),
            solution: { answers: [{ statementId: 's1', value: true }] } },
        },
      },
      {
        qtype: 'shortanswer', package: {
          ...base, questionText: document('Câu hỏi trả lời ngắn'),
          answers: [{ answer: document('HaNoi'), isCorrect: true, feedback: null, sortOrder: 0 }],
          options: { useCase: true },
        },
      },
      {
        qtype: 'essay', package: {
          ...base, questionText: document('Câu hỏi tự luận'),
          answerKey: { guidance: document('Hướng dẫn chấm tự luận'),
            solution: { answer: document('Bài giải mẫu tự luận') } },
        },
      },
    ].map((slot, index) => ({
      ...slot, position: index + 1, section: index < 2 ? 'Phần I' : 'Phần II',
      questionId: SHARED_ID, versionId: SHARED_ID, versionNumber: 1,
      maxMark: index === 3 ? 5 : 1, checksum: imageHash,
    }));
    const examPackage = {
      name: 'Đề duyệt có bốn dạng câu', grade: 10, examKind: 'final', totalScore: 8,
      durationMinutes: 60, tfScale: [0, 0.25, 0.5, 1],
      source: { centreSlug: 'school-a', examId: SHARED_ID, versionId: SHARED_ID, versionNumber: 2 },
      slots,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (isGetSessionUrl(url)) return respond(baSessionBody({ id: USER_ID, username: 'reviewer', email: 'reviewer@example.com' }));
      if (url === '/api/v1/users/me') return respond({
        id: USER_ID, username: 'reviewer', firstName: 'Biên', lastName: 'Tập',
        email: 'reviewer@example.com', suspended: false, deleted: false, isGuest: false,
        forcePasswordChange: false, lastLogin: null, createdAt: '2026-01-01T00:00:00Z', customFields: [],
      });
      if (url === '/api/v1/users/me/capabilities') return respond({
        userId: USER_ID, isSiteAdmin: true, assignments: [],
        contexts: [{ contextId: SYSTEM_CONTEXT, contextLevel: 10, instanceId: SYSTEM_CONTEXT,
          capabilities: ['systembank:review'] }],
      });
      if (url === '/api/v1/courses') return respond([]);
      if (url === '/api/v1/system-bank/exams/pending') {
        return respond([{ id: SHARED_ID, name: examPackage.name, sourceVersionNumber: 2,
          slotCount: 4, status: 'pending' }]);
      }
      if (url === `/api/v1/system-bank/exams/${SHARED_ID}`) return respond({ package: examPackage });
      if (url === `/api/v1/system-bank/exams/${SHARED_ID}/approve` && method === 'POST') {
        return respond({ id: SHARED_ID, status: 'approved' });
      }
      return respond([]);
    }));
    const router = createMemoryRouter([
      { path: '/system-bank/exams', element: <SystemSharedExamsPanel /> },
    ], { initialEntries: ['/system-bank/exams'] });
    const { container } = render(<TestProviders><RouterProvider router={router} /></TestProviders>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kiểm tra' }));
    expect(await screen.findByText('Đề duyệt có bốn dạng câu · v2')).toBeInTheDocument();
    expect(screen.getByText('Bài giải mẫu tự luận')).toBeInTheDocument();
    expect(screen.getByText('Hướng dẫn chấm tự luận')).toBeInTheDocument();
    expect(screen.getByText('Đáp án đúng A')).toBeInTheDocument();
    expect(screen.getByText('Hướng dẫn đúng sai')).toBeInTheDocument();
    expect(screen.getByText('HaNoi')).toBeInTheDocument();
    expect(screen.getByText('Phần: Phần II · Điểm tối đa: 5')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('0 · 0.25 · 0.5 · 1')).toBeInTheDocument();
    expect(container.querySelector(`img[src="/api/v1/system-bank/exams/${SHARED_ID}/media/${imageHash}"]`)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Duyệt và công bố' }));
    await waitFor(() => expect(calls.some((call) =>
      call.url === `/api/v1/system-bank/exams/${SHARED_ID}/approve` && call.method === 'POST')).toBe(true));
  });
});
