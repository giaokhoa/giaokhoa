import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { MyActivityGrades } from '@giaokhoa/contracts';
import { usePermissions, type CourseAccess } from '#lib/permissions';
import { useCoursesGradeData } from '#hooks/use-courses-grade-data';
import { displayCourseName, useCourseCardPrefs } from '#lib/course-cards';
import { upcomingDaysRangeIso } from '#features/calendar/utils/calendar';
import { useCalendarEvents } from '#features/calendar/queries/calendar';
import { formatWithOptions } from '#utils/date-format';
import { useMyBadges } from '#features/badges/queries/badges';
import { dashboardUnreadCountQueryOptions, useDashboardOverview } from '../queries/dashboard';
import { SectionCards, type StatCard } from '#components/section-cards';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { ChartAreaInteractive, type ChartPoint } from './chart-area-interactive';
import { DataTable, type DataColumn } from '#components/data-table';
import { SectionHeading } from './section-heading';
import { useDataTableLabels } from '../hooks/use-data-table-labels';

/**
 * Khối học tập của học viên trên trang tổng quan (tách từ `dashboard.tsx`,
 * S4): khối việc cần làm (DASH1), lưới 4 thẻ thống kê, biểu đồ sự kiện
 * lịch 30 ngày tới và bảng các khoá đang học kèm điểm trung bình của
 * chính mình. Dữ liệu vào từ ảnh chụp quyền (phân loại khoá học), điểm
 * theo bài tải lười theo khoá, huy hiệu, số thông báo chưa đọc và sự
 * kiện lịch; học viên không bao giờ chạm endpoint quản trị hay báo cáo
 * lớp từ khối này.
 */

/**
 * Phần trăm điểm theo từng bài đã có điểm (S23): một bài chỉ tính khi
 * đã có điểm cuối (`finalGrade` khác null/undefined) và điểm tối đa
 * của bài lớn hơn 0; mỗi phần trăm chuẩn hoá theo điểm tối đa của
 * chính bài đó. Dùng chung cho thẻ điểm trung bình và cột điểm của
 * từng khoá trong bảng, để ba chỗ không tự viết lại cùng một bộ lọc.
 *
 * @param activities - Các bài kèm điểm của học sinh trong một khoá.
 * @returns Phần trăm điểm của từng bài đủ điều kiện, theo đúng thứ tự đầu vào.
 */
function gradePercents(activities: MyActivityGrades['activities']): number[] {
  const pcts: number[] = [];
  for (const activity of activities) {
    const finalGrade = activity.grade?.finalGrade;
    if (finalGrade === null || finalGrade === undefined || activity.item.gradeMax <= 0) continue;
    pcts.push((finalGrade / activity.item.gradeMax) * 100);
  }
  return pcts;
}

/**
 * Điểm trung bình (phần trăm) của một tập bài — trung bình cộng của
 * `gradePercents`; null khi không có bài nào đủ điều kiện tính điểm.
 *
 * @param activities - Các bài kèm điểm của học sinh trong một khoá.
 * @returns Điểm trung bình theo phần trăm, hoặc null khi chưa có bài nào có điểm.
 */
function averageGradePercent(activities: MyActivityGrades['activities']): number | null {
  const pcts = gradePercents(activities);
  return pcts.length > 0 ? pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length : null;
}

/**
 * Khối tổng hợp DASH1 dùng chung cho cả hai vai: đúng MỘT query `GET /dashboard/overview` (TanStack dedupe theo queryKey nên khối GV và khối HS trên cùng trang chỉ phát một request). Endpoint đồng thời cập nhật mốc xem trước phía server khi tính xong danh sách "mới". Hook nằm ở tầng queries của feature dashboard (`queries/dashboard.ts`, F-01 của rà soát #133).
 */

/**
 * Khối "Việc cần làm" của học sinh (DASH1): hoạt động sắp đến hạn trong 7 ngày (quá hạn tách lên đầu, có badge trạng thái) và điểm/phản hồi mới đã công bố kể từ lần xem trước. Dữ liệu đã qua cổng công bố PH-0 phía server — khối này không bao giờ thấy điểm chưa công bố.
 */
function StudentTodoBlock() {
  const { t, i18n } = useTranslation('dashboard');
  const overview = useDashboardOverview();
  const data = overview.data;
  if (overview.isPending) {
    return (
      <div className="px-4 lg:px-6" data-testid="dashboard-todo">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!data) return null;
  const statusLabel = (status: string) =>
    status === 'overdue' ? t('todoOverdue') : status === 'in_progress' ? t('todoInProgress') : t('todoNotStarted');
  return (
    <Card data-testid="dashboard-todo">
      <CardHeader>
        <CardTitle>{t('todoTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h3 className="mb-2 text-sm font-medium">{t('todoDueTitle')}</h3>
          {data.dueItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('todoEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.dueItems.map((item) => (
                <li
                  key={`${item.kind}-${item.cmId}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                  data-testid="todo-due-item"
                >
                  <Badge variant={item.status === 'overdue' ? 'destructive' : 'secondary'}>
                    {statusLabel(item.status)}
                  </Badge>
                  <Link
                    to={
                      item.kind === 'quiz'
                        ? `/courses/${item.courseId}/exams/${item.activityId}`
                        : `/courses/${item.courseId}/assignments/${item.activityId}`
                    }
                    className="font-medium hover:underline"
                  >
                    {item.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {item.kind === 'quiz' ? t('todoKindQuiz') : t('todoKindAssignment')} · {item.courseName} ·{' '}
                    {t('todoDueAt', { date: formatWithOptions(item.dueAt, i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data.newResults.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">{t('todoNewResultsTitle')}</h3>
            <ul className="flex flex-col gap-2">
              {data.newResults.map((result, idx) => (
                <li key={`${result.kind}-${result.itemId ?? result.courseId}-${idx}`} className="text-sm" data-testid="todo-new-result">
                  <Link
                    to={`/courses/${result.courseId}/grades`}
                    className="font-medium hover:underline"
                  >
                    {`${result.itemName ?? ''} — ${t('newResultGrade', { grade: result.finalGrade ?? '—', max: result.gradeMax ?? '—' })}`}
                  </Link>
                  <span className="text-muted-foreground"> · {result.courseName}</span>
                  {result.feedback && <span className="block text-muted-foreground">{result.feedback}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Khối học tập của học viên: khoá đang học lấy từ tầng quyền (ghi
 * danh), điểm của chính mình theo từng khoá tải lười tại khối này qua
 * `useCoursesGradeData` (F-02, rà soát #133); huy hiệu đã cấp
 * và thông báo chưa đọc gọi các endpoint tự phục vụ tương ứng; biểu đồ là
 * sự kiện lịch 30 ngày tới theo ngày. Học viên không bao giờ chạm endpoint
 * quản trị hay báo cáo lớp từ khối này.
 */
export function StudentSection() {
  const { t, i18n } = useTranslation(['dashboard', 'app']);
  const perms = usePermissions();
  const prefs = useCourseCardPrefs();
  const tableLabels = useDataTableLabels();
  const learning = perms.learning;
  const gradeData = useCoursesGradeData(learning.map((c) => c.course.id));
  const gradebookOf = (c: CourseAccess) => gradeData.get(c.course.id)?.gradebook ?? null;
  // Huy hiệu, thông báo và sự kiện lịch là ba query độc lập chạy SONG
  // SONG — trước đây một effect await lần lượt từng endpoint nên thẻ
  // thống kê mọc nối tiếp và đẩy bố cục (nguồn CLS đội audit đo được).
  const badgesQuery = useMyBadges();
  // Chỉ cần SỐ chưa đọc cho thẻ thống kê: dùng endpoint đếm riêng,
  // không tải toàn bộ lịch sử thông báo về rồi lọc phía client nữa
  // (trung tâm thông báo v2, issue #51).
  const notificationsQuery = useQuery(dashboardUnreadCountQueryOptions());
  // Cửa sổ sự kiện 30 ngày: tính theo múi giờ ứng dụng qua helper
  // dùng chung với loader SL-1 của route `/` (trước đây lấy đúng mốc
  // tức thời lúc mount — key chứa mốc mili-giây thì loader phía
  // server không bao giờ tính lại trùng để dehydrate được; xem
  // `upcomingDaysRangeIso` ở features/calendar/utils/calendar). Cửa sổ mới bắt đầu từ
  // 00:00 hôm nay nên phủ đúng ô ngày đầu của biểu đồ bên dưới.
  const eventRange = useMemo(() => upcomingDaysRangeIso(30), []);
  const eventsQuery = useCalendarEvents(eventRange.from, eventRange.to);

  const badgeCount = badgesQuery.data ? badgesQuery.data.length : null;
  const unread = notificationsQuery.data ? notificationsQuery.data.unread : null;
  const activityPcts: number[] = [];
  for (const access of learning) {
    activityPcts.push(...gradePercents(gradebookOf(access)?.activities ?? []));
  }
  const average =
    activityPcts.length > 0
      ? activityPcts.reduce((sum, pct) => sum + pct, 0) / activityPcts.length
      : null;

  // Lưới thẻ luôn đủ 4 ô: thẻ huy hiệu/thông báo giữ ô ở trạng thái
  // loading trong lúc query chạy và hiện "—" nếu nguồn lỗi, thay vì
  // biến mất rồi làm lưới co lại như trước.
  const cards: StatCard[] = [
    {
      id: 'student-courses',
      label: t('statLearningCourses'),
      value: String(learning.length),
      footer: t('statLearningFooter'),
    },
    {
      id: 'student-average',
      label: t('statAverageGrade'),
      value: average === null ? '—' : `${average.toFixed(1)}%`,
      footer: t('statAverageFooter', { count: activityPcts.length }),
    },
    {
      id: 'student-badges',
      label: t('statMyBadges'),
      value: badgeCount === null ? '—' : String(badgeCount),
      footer: t('statBadgesFooter'),
      loading: badgesQuery.isPending,
    },
    {
      id: 'student-unread',
      label: t('statUnread'),
      value: unread === null ? '—' : String(unread),
      footer: t('statUnreadFooter'),
      loading: notificationsQuery.isPending,
    },
  ];

  const [today] = useState(() => new Date());
  const chartData: ChartPoint[] = useMemo(() => {
    const events = eventsQuery.data ?? [];
    const start = new Date(today.getTime());
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 30 }, (_, i) => {
      const day = new Date(start.getTime() + i * 86_400_000);
      const next = new Date(day.getTime() + 86_400_000);
      const value = events.filter((e) => {
        const at = new Date(e.timeStart);
        return at >= day && at < next;
      }).length;
      return { label: formatWithOptions(day, i18n.language, { day: '2-digit', month: '2-digit' }), value };
    });
  }, [eventsQuery.data, i18n.language, today]);

  const columns: DataColumn<CourseAccess>[] = [
    {
      id: 'course',
      header: t('colCourse'),
      cell: (c) => <Link to={`/courses/${c.course.id}`}>{displayCourseName(prefs.data?.get(c.course.id), c.course.fullName)}</Link>,
      sortValue: (c) => c.course.fullName,
    },
    {
      id: 'mygrade',
      header: t('colMyGrade'),
      cell: (c) => {
        const courseAverage = averageGradePercent(gradebookOf(c)?.activities ?? []);
        if (courseAverage === null) return '—';
        return `${courseAverage.toFixed(1)}%`;
      },
      sortValue: (c) => averageGradePercent(gradebookOf(c)?.activities ?? []) ?? -1,
    },
    {
      id: 'actions',
      header: t('colActions'),
      cell: (c) => (
        <span className="flex gap-2">
          <Button size="sm" variant="outline" render={<Link to={`/courses/${c.course.id}`} />}>
            {t('openCourse')}
          </Button>
          <Button size="sm" variant="outline" render={<Link to={`/courses/${c.course.id}/grades`} />}>
            {t('viewGradebook')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-4 md:gap-6" data-testid="dashboard-student">
      <SectionHeading title={t('studentSection')} />
      <StudentTodoBlock />
      <SectionCards cards={cards} />
      <ChartAreaInteractive
        title={t('chartStudentTitle')}
        description={t('chartStudentDescription')}
        seriesLabel={t('chartStudentSeries')}
        emptyText={t('chartNoData')}
        data={chartData}
        ranges={[
          { value: '7', label: t('rangeDays', { count: 7 }), count: 7 },
          { value: '30', label: t('rangeDays', { count: 30 }), count: 30 },
        ]}
      />
      <DataTable
        title={t('tableLearningTitle')}
        data={learning}
        columns={columns}
        getRowId={(c) => c.course.id}
        labels={tableLabels}
      />
    </section>
  );
}
