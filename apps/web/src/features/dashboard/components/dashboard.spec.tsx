import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@giaokhoa/contracts';
import { TestProviders } from '#test/providers';
import { stubFetch, userProfile, type StubFetchHandler } from '#test/stub-fetch';
import { baSessionBody, isGetSessionUrl } from '#test/ba-session';
import { PermissionsProvider } from '#lib/permissions';
import { DashboardPage } from './dashboard';

const ADMIN_ID = '01900000-0000-7000-8000-0000000000a1';
const TEACHER_ID = '01900000-0000-7000-8000-0000000000a2';
const STUDENT_ID = '01900000-0000-7000-8000-0000000000a3';
const COURSE_ID = '01900000-0000-7000-8000-000000000010';
const CATEGORY_ID = '01900000-0000-7000-8000-000000000001';

const COURSE = {
  id: COURSE_ID,
  category: CATEGORY_ID,
  fullName: 'Khoá học mẫu',
  shortName: 'DEMO101',
  idNumber: '',
  summary: '',
  format: 'topics',
  visible: true,
  startDate: null,
  endDate: null,
  groupMode: 0,
  enableCompletion: true,
};

/** Hồ sơ mẫu theo từng vai (S24): dùng `userProfile` dùng chung, chỉ ghi đè id/username/tên/email/mốc tạo để khớp vai đang stub. */
const PROFILES: Record<string, UserProfile> = {
  admin: userProfile({
    id: ADMIN_ID,
    username: 'admin',
    firstName: 'Quản',
    lastName: 'Trị',
    email: 'admin@example.com',
    createdAt: '2026-10-01T00:00:00.000Z',
  }),
  teacher1: userProfile({
    id: TEACHER_ID,
    username: 'teacher1',
    firstName: 'Lan Anh',
    lastName: 'Nguyễn',
    email: 'teacher1@example.com',
    createdAt: '2026-10-01T00:00:00.000Z',
  }),
  student1: userProfile({
    id: STUDENT_ID,
    username: 'student1',
    firstName: 'Minh Quân',
    lastName: 'Trần',
    email: 'student1@example.com',
    createdAt: '2026-10-01T00:00:00.000Z',
  }),
};

const GRADEBOOK = {
  courseId: COURSE_ID,
  userId: STUDENT_ID,
  activities: [
    {
      item: { id: '01900000-0000-7000-8000-000000000090', itemName: 'Kiểm tra 1', gradeMax: 10 },
      grade: { finalGrade: 8.5 },
      publication: { policy: 'auto', published: true },
    },
  ],
};

const REPORT = {
  courseId: COURSE_ID,
  items: [{ id: '01900000-0000-7000-8000-000000000090', itemName: 'Kiểm tra 1', gradeMax: 10 }],
  publications: { '01900000-0000-7000-8000-000000000090': { policy: 'auto', published: true } },
  rows: [
    { userId: STUDENT_ID, displayName: 'Trần Minh Quân', grades: { '01900000-0000-7000-8000-000000000090': 8.5 } },
    { userId: '01900000-0000-7000-8000-0000000000a4', displayName: 'Bạn Học Khác', grades: { '01900000-0000-7000-8000-000000000090': null } },
  ],
};

const FORBIDDEN = { type: 'about:blank', title: 'Forbidden', status: 403, code: 'access.capability_denied' };

const SYS_CTX_ID = '01900000-0000-7000-8000-0000000000e1';
const COURSE_CTX_ID = '01900000-0000-7000-8000-0000000000e2';

/** Ảnh chụp quyền (GET /users/me/capabilities) mà API thật trả cho từng vai trò. */
function accessView(role: 'admin' | 'teacher' | 'student') {
  const me = role === 'admin' ? PROFILES.admin : role === 'teacher' ? PROFILES.teacher1 : PROFILES.student1;
  if (role === 'admin') {
    return {
      userId: me.id,
      isSiteAdmin: true,
      assignments: [],
      contexts: [
        {
          contextId: SYS_CTX_ID,
          contextLevel: 10,
          contextPath: '/1',
          capabilities: ['user:viewdetails', 'role:manage'],
        },
      ],
    };
  }
  return {
    userId: me.id,
    isSiteAdmin: false,
    assignments: [
      {
        id: '01900000-0000-7000-8000-0000000000f1',
        roleId: '01900000-0000-7000-8000-0000000000b9',
        roleShortname: role === 'teacher' ? 'editingteacher' : 'student',
        roleName: role === 'teacher' ? 'Teacher' : 'Student',
        contextId: COURSE_CTX_ID,
        contextLevel: 50,
        contextPath: '/1/9/10',
        instanceId: COURSE_ID,
      },
    ],
    contexts: [
      { contextId: SYS_CTX_ID, contextLevel: 10, contextPath: '/1', capabilities: [] },
      {
        contextId: COURSE_CTX_ID,
        contextLevel: 50,
        contextPath: '/1/9/10',
        capabilities:
          role === 'teacher'
            ? ['grade:viewall', 'course:update', 'question:useall']
            : ['course:view'],
      },
    ],
  };
}

/**
 * Stub fetch theo đúng bề mặt API thật: quyền của từng vai trò được khai
 * qua GET /users/me/capabilities (đúng nguồn PermissionsProvider đọc),
 * còn các endpoint dữ liệu bị khoá quyền vẫn trả 403 như PermissionEvaluator
 * của API để test kiểm chứng cả dữ liệu hiển thị theo vai trò.
 * Dùng `stubFetch` dùng chung ở `#test/stub-fetch` (S24): handler trả
 * thân JSON (đáp 200), cặp `{ status, body }` (đáp đúng trạng thái đó),
 * hoặc `undefined` (đáp 404).
 */
function renderApp() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <DashboardPage />,
    },
  ]);
  render(
    <TestProviders>
      <PermissionsProvider>
        <RouterProvider router={router} />
      </PermissionsProvider>
    </TestProviders>,
  );
}

function baseHandler(role: 'admin' | 'teacher' | 'student'): StubFetchHandler {
  const me = role === 'admin' ? PROFILES.admin : role === 'teacher' ? PROFILES.teacher1 : PROFILES.student1;
  return (url) => {
    // Phiên cookie Better Auth: id phiên khớp hồ sơ của vai đang stub.
    if (isGetSessionUrl(url)) return baSessionBody({ id: me.id, username: me.username, email: me.email });
    if (url === '/api/v1/users/me') return me;
    if (url === '/api/v1/users/me/capabilities') return accessView(role);
    if (url.startsWith('/api/v1/users?')) {
      if (role !== 'admin') return { status: 403, body: FORBIDDEN };
      return url.includes('pageSize=100')
        ? { users: [PROFILES.admin, PROFILES.teacher1, PROFILES.student1], total: 3, page: 1, pageSize: 100 }
        : { users: [PROFILES.admin], total: 3, page: 1, pageSize: 1 };
    }
    if (url === '/api/v1/access/roles') {
      return role === 'admin'
        ? [
            {
              id: '01900000-0000-7000-8000-0000000000b1',
              name: 'Quản lý',
              shortName: 'manager',
              description: '',
              archetype: 'manager',
            },
            {
              id: '01900000-0000-7000-8000-0000000000b2',
              name: 'Học viên',
              shortName: 'student',
              description: '',
              archetype: 'student',
            },
          ]
        : { status: 403, body: FORBIDDEN };
    }
    if (url === '/api/v1/questions/categories') return role === 'student' ? { status: 403, body: FORBIDDEN } : [];
    if (url === '/api/v1/courses') return [COURSE];
    if (url === '/api/v1/courses/categories/tree') {
      return [
        {
          ...COURSE,
          id: CATEGORY_ID,
          name: 'Danh mục mẫu',
          idNumber: null,
          description: '',
          parent: null,
          sortOrder: 0,
          path: '/1',
          depth: 1,
          visible: true,
          children: [],
        },
      ];
    }
    if (url === `/api/v1/courses/${COURSE_ID}/enrolments/me`) {
      return role === 'admin'
        ? { courseId: COURSE_ID, userId: me.id, enrolled: false, active: false }
        : { courseId: COURSE_ID, userId: me.id, enrolled: true, active: true };
    }
    if (url === `/api/v1/courses/${COURSE_ID}/gradebook/report`) {
      return role === 'student' ? { status: 403, body: FORBIDDEN } : REPORT;
    }
    if (url === `/api/v1/courses/${COURSE_ID}/gradebook`) {
      return role === 'admin' ? { status: 403, body: FORBIDDEN } : GRADEBOOK;
    }
    if (url === '/api/v1/badges/mine') return [{ id: 'x' }, { id: 'y' }];
    // DASH1 (issue #121): endpoint tổng hợp dashboard + thẻ khoá.
    if (url.startsWith('/api/v1/dashboard/overview')) {
      const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const past = new Date(Date.now() - 3_600_000).toISOString();
      return {
        generatedAt: new Date().toISOString(),
        previousSeenAt: null,
        dueWindowDays: 7,
        dueItems:
          role === 'student'
            ? [
                { courseId: COURSE_ID, courseName: 'Khoá học mẫu', cmId: 'cm-overdue', activityId: 'a-overdue', kind: 'assignment', name: 'Bài nộp quá hạn', dueAt: past, status: 'overdue' },
                { courseId: COURSE_ID, courseName: 'Khoá học mẫu', cmId: 'cm-quiz', activityId: 'q-soon', kind: 'quiz', name: 'Quiz sắp đến hạn', dueAt: soon, status: 'not_started' },
              ]
            : [],
        newResults:
          role === 'student'
            ? [
                { courseId: COURSE_ID, courseName: 'Khoá học mẫu', kind: 'grade_item', itemId: 'item-1', itemName: 'Điểm kiểm tra', vnScope: null, finalGrade: 9, gradeMax: 10, feedback: 'Làm tốt', changedAt: new Date().toISOString() },
              ]
            : [],
        gradingQueue:
          role === 'teacher'
            ? [{ courseId: COURSE_ID, courseName: 'Khoá học mẫu', pendingCount: 5, assignmentPending: 2, quizPending: 1, paperPending: 2, paperPinId: 'quiz-paper-1', oldestPendingAt: past }]
            : [],
      };
    }
    if (url === '/api/v1/dashboard/course-cards') return { prefs: [] };
    // Dashboard chỉ còn hỏi SỐ chưa đọc (trung tâm v2, issue #51).
    if (url === '/api/v1/notifications/unread-count') {
      return { unread: 1 };
    }
    if (url.startsWith('/api/v1/calendar/events')) {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      return [{ id: 'e1', name: 'Sự kiện mẫu', timeStart: tomorrow }];
    }
    return undefined;
  };
}

describe('Dashboard theo vai trò', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom thiếu matchMedia/ResizeObserver mà sidebar và biểu đồ cần.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* no-op cho jsdom */
        }
        unobserve() {
          /* no-op cho jsdom */
        }
        disconnect() {
          /* no-op cho jsdom */
        }
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('student thấy khối việc cần làm DASH1 ở đầu dashboard: quá hạn tách rõ + điểm mới', async () => {
    stubFetch(baseHandler('student'));
    renderApp();
    // Chờ nội dung thật (skeleton chờ tải mang cùng testid nên không chờ theo testid).
    expect(await screen.findByText('Bài nộp quá hạn')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-todo')).toBeInTheDocument();
    const items = screen.getAllByTestId('todo-due-item');
    expect(items).toHaveLength(2);
    // Quá hạn đứng đầu danh sách (API đã sắp) và mang nhãn Quá hạn.
    expect(items[0]).toHaveTextContent('Bài nộp quá hạn');
    expect(items[0]).toHaveTextContent('Quá hạn');
    expect(items[1]).toHaveTextContent('Quiz sắp đến hạn');
    // ĐX-5 (issue #179): việc cần làm trỏ thẳng tới trang hoạt động, không về trang khoá chung.
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe(`/courses/${COURSE_ID}/assignments/a-overdue`);
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe(`/courses/${COURSE_ID}/exams/q-soon`);
    // Điểm mới đã công bố hiện kèm điểm số.
    const fresh = screen.getByTestId('todo-new-result');
    expect(fresh).toHaveTextContent('Điểm kiểm tra');
    expect(fresh).toHaveTextContent('9 / 10');
  });

  it('teacher thấy hàng đợi chấm DASH1 gộp theo khoá với số chờ đúng', async () => {
    stubFetch(baseHandler('teacher'));
    renderApp();
    const row = await screen.findByTestId('grading-queue-row');
    expect(screen.getByTestId('dashboard-grading-queue')).toBeInTheDocument();
    expect(row).toHaveTextContent('Khoá học mẫu');
    expect(row).toHaveTextContent('5');
    // Bấm vào hàng đợi tới thẳng trang điểm của khoá (href nằm ở thẻ
    // liên kết bao quanh hàng — Button render qua Link của Base UI).
    const queueLink = row.closest('a') ?? row.querySelector('a');
    expect(queueLink?.getAttribute('href')).toBe(`/courses/${COURSE_ID}/grades`);
    // Phần phiếu giấy CAM-0 (#187): đếm tách bạch + deep-link thẳng tới
    // bề mặt rà soát phiếu của đúng quiz có phiếu chờ lâu nhất.
    const paperLink = screen.getByTestId('grading-paper-link');
    expect(paperLink).toHaveTextContent('2 phiếu giấy chờ xử lý');
    expect(paperLink.getAttribute('href')).toBe(`/courses/${COURSE_ID}/exams/quiz-paper-1/paper`);
  });

  it('admin thấy khối quản trị hệ thống, không thấy khối giảng dạy/học tập', async () => {
    stubFetch(baseHandler('admin'));
    renderApp();
    expect(await screen.findByText('Quản trị hệ thống')).toBeInTheDocument();
    expect(await screen.findByText('Tổng người dùng')).toBeInTheDocument();
    // Bảng người dùng thật từ API quản trị.
    expect(await screen.findByText('teacher1')).toBeInTheDocument();
    expect(screen.queryByText('Giảng dạy')).not.toBeInTheDocument();
    expect(screen.queryByText('Học tập của tôi')).not.toBeInTheDocument();
  });

  it('student chỉ thấy khối học tập của mình với điểm thật, không thấy khối quản trị/giảng dạy', async () => {
    stubFetch(baseHandler('student'));
    renderApp();
    expect(await screen.findByText('Học tập của tôi')).toBeInTheDocument();
    // Điểm trung bình từ điểm bài 8.5/10 đã công bố của học sinh — hiện ở
    // cả thẻ thống kê lẫn cột điểm của khoá trong bảng (cùng một giá trị).
    expect((await screen.findAllByText('85.0%')).length).toBeGreaterThanOrEqual(1);
    // Bảng khoá học của tôi có khoá đã ghi danh.
    expect(await screen.findByText('Khoá học mẫu')).toBeInTheDocument();
    expect(screen.queryByText('Quản trị hệ thống')).not.toBeInTheDocument();
    expect(screen.queryByText('Giảng dạy')).not.toBeInTheDocument();
  });

  it('teacher thấy khối giảng dạy với hàng đợi chấm thật, không thấy khối quản trị/học tập', async () => {
    stubFetch(baseHandler('teacher'));
    renderApp();
    expect(await screen.findByText('Giảng dạy')).toBeInTheDocument();
    // Báo cáo lớp có 2 học viên, 1 người chưa có điểm → thẻ "Chưa có điểm" = 1.
    const ungradedCard = await screen.findByTestId('stat-card-teacher-ungraded');
    await waitFor(() => expect(ungradedCard).toHaveTextContent('1'));
    expect(screen.queryByText('Quản trị hệ thống')).not.toBeInTheDocument();
    expect(screen.queryByText('Học tập của tôi')).not.toBeInTheDocument();
  });

});
