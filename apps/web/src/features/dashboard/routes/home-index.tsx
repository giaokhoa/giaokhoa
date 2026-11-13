import { Suspense, lazy } from 'react';
import type {
  Course,
  CourseActivityGrid,
  CourseCategoryTreeNode,
  DashboardOverviewView,
  MyAccessView,
  MyActivityGrades,
  Role,
  UserListResponse,
} from '@giaokhoa/contracts';
import { useAuth } from '#lib/auth';
import { HomePage } from '../components/home';
import { DashboardSkeleton } from '../components/dashboard-skeleton';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as dashboardQueryKeys } from '../queries/keys';
import { buildSsrLoaderData, serverProbe, serverQueryFn, type SsrLoaderData } from '#lib/ssr-data';
import { upcomingDaysRangeIso } from '#features/calendar/utils/calendar';
import type { CalendarEventView } from '#features/calendar/types/calendar';
import { hasCourseAssignment, systemCapabilities } from '#lib/permissions';
import { CourseGradeData } from '#hooks/use-courses-grade-data';
import { MyBadgeView } from '#features/badges/types/badges';

export async function loader({ request }: { request: Request }): Promise<SsrLoaderData> {
  return buildSsrLoaderData(request, async (queryClient, req) => {
    const range = upcomingDaysRangeIso(30);
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.capabilities,
        queryFn: serverQueryFn<MyAccessView>(req, '/api/v1/users/me/capabilities'),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.courses,
        queryFn: serverQueryFn<Course[]>(req, '/api/v1/courses'),
      }),
      queryClient.prefetchQuery({
        queryKey: dashboardQueryKeys.dashboardOverview,
        queryFn: serverQueryFn<DashboardOverviewView>(req, '/api/v1/dashboard/overview?days=7'),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.myBadges,
        queryFn: serverQueryFn<MyBadgeView[]>(req, '/api/v1/badges/mine'),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.notificationUnreadCount,
        queryFn: serverQueryFn<{ unread: number }>(req, '/api/v1/notifications/unread-count'),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.calendarEvents(range.from, range.to),
        queryFn: serverQueryFn<CalendarEventView[]>(
          req,
          `/api/v1/calendar/events?from=${range.from}&to=${range.to}`,
        ),
      }),
    ]);

    const access = queryClient.getQueryData<MyAccessView>(queryKeys.capabilities);
    const courses = queryClient.getQueryData<Course[]>(queryKeys.courses);
    if (!access || !courses) return;

    const memberCourses = courses.filter((course) => hasCourseAssignment(access, course));
    const gradePrefetches = memberCourses.map((course) =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.courseAccess(course.id),
        queryFn: async (): Promise<CourseGradeData> => {
          const [report, gradebook] = await Promise.all([
            serverProbe<CourseActivityGrid>(req, `/api/v1/courses/${course.id}/gradebook/report`),
            serverProbe<MyActivityGrades>(req, `/api/v1/courses/${course.id}/gradebook`),
          ]);
          return { report, gradebook };
        },
      }),
    );

    const sysCaps = systemCapabilities(access);
    const canAdminister =
      access.isSiteAdmin || sysCaps.includes('role:manage') || sysCaps.includes('site:config');
    const adminPrefetches = canAdminister
      ? [
          queryClient.prefetchQuery({
            queryKey: queryKeys.adminUsers(1, 100),
            queryFn: serverQueryFn<UserListResponse>(req, '/api/v1/users?page=1&pageSize=100'),
          }),
          queryClient.prefetchQuery({
            queryKey: queryKeys.categoryTree,
            queryFn: serverQueryFn<CourseCategoryTreeNode[]>(req, '/api/v1/courses/categories/tree'),
          }),
          queryClient.prefetchQuery({
            queryKey: queryKeys.roles,
            queryFn: serverQueryFn<Role[]>(req, '/api/v1/access/roles'),
          }),
        ]
      : [];

    await Promise.all([...gradePrefetches, ...adminPrefetches]);
  });
}

const DashboardPage = lazy(() => import('../components/dashboard').then((m) => ({ default: m.DashboardPage })));

export default function HomeIndexRoute() {
  const { user } = useAuth();
  if (!user) return <HomePage />;
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardPage />
    </Suspense>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
export function meta() {
  return [{ title: 'Giáo khoa' }];
}
