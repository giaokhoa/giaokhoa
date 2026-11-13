import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '#test/providers';
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

function profile(id: string, username: string, firstName: string, lastName: string) {
  return {
    id,
    username,
    firstName,
    lastName,
    email: `${username}@example.com`,
    suspended: false,
    deleted: false,
    isGuest: false,
    forcePasswordChange: false,
    lastLogin: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    customFields: [],
  };
}

const PROFILES: Record<string, ReturnType<typeof profile>> = {
  admin: profile(ADMIN_ID, 'admin', 'Quản', 'Trị'),
  teacher1: profile(TEACHER_ID, 'teacher1', 'Lan Anh', 'Nguyễn'),
  student1: profile(STUDENT_ID, 'student1', 'Minh Quân', 'Trần'),
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

type Handler = (url: string) => { status: number; body: unknown } | undefined;

function ok(body: unknown) {
  return { status: 200, body };
}
function forbidden() {
  return { status: 403, body: FORBIDDEN };
}

function stubFetch(handler: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const result = handler(url);
      if (!result) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

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

function baseHandler(role: 'admin' | 'teacher' | 'student'): Handler {
  const me = role === 'admin' ? PROFILES.admin : role === 'teacher' ? PROFILES.teacher1 : PROFILES.student1;
  return (url) => {
    if (isGetSessionUrl(url)) return ok(baSessionBody({ id: me.id, username: me.username, email: me.email }));
    if (url === '/api/v1/users/me') return ok(me);
    if (url === '/api/v1/users/me/capabilities') return ok(accessView(role));
    if (url.startsWith('/api/v1/users?')) {
      if (role !== 'admin') return forbidden();
      return url.includes('pageSize=100')
        ? ok({ users: [PROFILES.admin, PROFILES.teacher1, PROFILES.student1], total: 3, page: 1, pageSize: 100 })
        : ok({ users: [PROFILES.admin], total: 3, page: 1, pageSize: 1 });
    }
    if (url === '/api/v1/access/roles') {
      return role === 'admin'
        ? ok([
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
          ])
        : forbidden();
    }
    if (url === '/api/v1/questions/categories') return role === 'student' ? forbidden() : ok([]);
    if (url === '/api/v1/courses') return ok([COURSE]);
    if (url === '/api/v1/courses/categories/tree') {
      return ok([
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
      ]);
    }
    if (url === `/api/v1/courses/${COURSE_ID}/enrolments/me`) {
      return role === 'admin'
        ? ok({ courseId: COURSE_ID, userId: me.id, enrolled: false, active: false })
        : ok({ courseId: COURSE_ID, userId: me.id, enrolled: true, active: true });
    }
    if (url === `/api/v1/courses/${COURSE_ID}/gradebook/report`) {
      return role === 'student' ? forbidden() : ok(REPORT);
    }
    if (url === `/api/v1/courses/${COURSE_ID}/gradebook`) {
      return role === 'admin' ? forbidden() : ok(GRADEBOOK);
    }
    if (url === '/api/v1/badges/mine') return ok([{ id: 'x' }, { id: 'y' }]);
    if (url.startsWith('/api/v1/dashboard/overview')) {
      const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const past = new Date(Date.now() - 3_600_000).toISOString();
      return ok({
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
      });
    }
    if (url === '/api/v1/dashboard/course-cards') return ok({ prefs: [] });
    if (url === '/api/v1/notifications/unread-count') {
      return ok({ unread: 1 });
    }
    if (url.startsWith('/api/v1/calendar/events')) {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      return ok([{ id: 'e1', name: 'Sự kiện mẫu', timeStart: tomorrow }]);
    }
    return undefined;
  };
}

describe('Dashboard theo vai trò', () => {
  beforeEach(() => {
    localStorage.clear();
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
        }
        unobserve() {
        }
        disconnect() {
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
    expect(await screen.findByText('Bài nộp quá hạn')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-todo')).toBeInTheDocument();
    const items = screen.getAllByTestId('todo-due-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Bài nộp quá hạn');
    expect(items[0]).toHaveTextContent('Quá hạn');
    expect(items[1]).toHaveTextContent('Quiz sắp đến hạn');
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe(`/courses/${COURSE_ID}/assignments/a-overdue`);
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe(`/courses/${COURSE_ID}/exams/q-soon`);
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
    const queueLink = row.closest('a') ?? row.querySelector('a');
    expect(queueLink?.getAttribute('href')).toBe(`/courses/${COURSE_ID}/grades`);
    const paperLink = screen.getByTestId('grading-paper-link');
    expect(paperLink).toHaveTextContent('2 phiếu giấy chờ xử lý');
    expect(paperLink.getAttribute('href')).toBe(`/courses/${COURSE_ID}/exams/quiz-paper-1/paper`);
  });

  it('admin thấy khối quản trị hệ thống, không thấy khối giảng dạy/học tập', async () => {
    stubFetch(baseHandler('admin'));
    renderApp();
    expect(await screen.findByText('Quản trị hệ thống')).toBeInTheDocument();
    expect(await screen.findByText('Tổng người dùng')).toBeInTheDocument();
    expect(await screen.findByText('teacher1')).toBeInTheDocument();
    expect(screen.queryByText('Giảng dạy')).not.toBeInTheDocument();
    expect(screen.queryByText('Học tập của tôi')).not.toBeInTheDocument();
  });

  it('student chỉ thấy khối học tập của mình với điểm thật, không thấy khối quản trị/giảng dạy', async () => {
    stubFetch(baseHandler('student'));
    renderApp();
    expect(await screen.findByText('Học tập của tôi')).toBeInTheDocument();
    expect((await screen.findAllByText('85.0%')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Khoá học mẫu')).toBeInTheDocument();
    expect(screen.queryByText('Quản trị hệ thống')).not.toBeInTheDocument();
    expect(screen.queryByText('Giảng dạy')).not.toBeInTheDocument();
  });

  it('teacher thấy khối giảng dạy với hàng đợi chấm thật, không thấy khối quản trị/học tập', async () => {
    stubFetch(baseHandler('teacher'));
    renderApp();
    expect(await screen.findByText('Giảng dạy')).toBeInTheDocument();
    const ungradedCard = await screen.findByTestId('stat-card-teacher-ungraded');
    await waitFor(() => expect(ungradedCard).toHaveTextContent('1'));
    expect(screen.queryByText('Quản trị hệ thống')).not.toBeInTheDocument();
    expect(screen.queryByText('Học tập của tôi')).not.toBeInTheDocument();
  });

});
