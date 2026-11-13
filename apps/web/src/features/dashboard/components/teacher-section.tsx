import { useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermissions, type CourseAccess } from '#lib/permissions';
import { useCoursesGradeData } from '#hooks/use-courses-grade-data';
import { displayCourseName, useCourseCardPrefs } from '#lib/course-cards';
import { formatWithOptions } from '#utils/date-format';
import { useDashboardOverview } from '../queries/dashboard';
import { SectionCards, type StatCard } from '#components/section-cards';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { ChartAreaInteractive, type ChartPoint } from './chart-area-interactive';
import { DataTable, type DataColumn } from '#components/data-table';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { SectionHeading } from './section-heading';
import { useDataTableLabels } from '../hooks/use-data-table-labels';

/**
 * Khối giảng dạy của trang tổng quan (tách từ `dashboard.tsx`, S4):
 * hàng đợi chấm (DASH1), lưới 3 thẻ thống kê, biểu đồ phân bố điểm
 * theo từng ô của lưới điểm và bảng các khoá đang dạy. Dữ liệu vào từ
 * ảnh chụp quyền (phân loại khoá dạy) và lưới điểm tải lười theo khoá;
 * khối tổng hợp DASH1 dùng chung với khối học sinh qua một query duy nhất.
 */

/**
 * Khối "Hàng đợi chấm" của giáo viên (DASH1): số bài chờ chấm gộp theo
 * khoá (bài nộp C2 chưa trả bài + lượt quiz chờ chấm tay + phiếu giấy
 * CAM-0 chờ xử lý) và bài chờ lâu nhất; bấm vào tới sổ điểm của khoá để
 * xử lý hàng đợi, riêng phần phiếu giấy là deep-link thẳng tới bề mặt rà
 * soát CAM-0 của quiz có phiếu chờ lâu nhất (issue #187).
 */
function TeacherGradingBlock() {
  const { t, i18n } = useTranslation('dashboard');
  const overview = useDashboardOverview();
  const prefs = useCourseCardPrefs();
  const data = overview.data;
  if (overview.isPending) {
    return (
      <div className="px-4 lg:px-6" data-testid="dashboard-grading-queue">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!data) return null;
  return (
    <Card data-testid="dashboard-grading-queue">
      <CardHeader>
        <CardTitle>{t('gradingQueueTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.gradingQueue.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('gradingQueueEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.gradingQueue.map((row) => (
              <li key={row.courseId} className="flex flex-wrap items-center gap-2 text-sm" data-testid="grading-queue-row">
                <Link to={`/courses/${row.courseId}/grades`} className="font-medium hover:underline">
                  {displayCourseName(prefs.data?.get(row.courseId), row.courseName)}
                </Link>
                <Badge>{t('gradingPending', { count: row.pendingCount })}</Badge>
                <span className="text-muted-foreground">
                  {row.assignmentPending > 0 ? t('gradingAssignmentPart', { count: row.assignmentPending }) : null}
                  {row.assignmentPending > 0 && row.quizPending > 0 ? ' · ' : null}
                  {row.quizPending > 0 ? t('gradingQuizPart', { count: row.quizPending }) : null}
                  {(row.assignmentPending > 0 || row.quizPending > 0) && row.paperPending > 0 ? ' · ' : null}
                  {row.paperPending > 0 && row.paperPinId ? (
                    <Link
                      to={`/courses/${row.courseId}/exams/${row.paperPinId}/paper`}
                      className="font-medium text-foreground hover:underline"
                      data-testid="grading-paper-link"
                    >
                      {t('gradingPaperPart', { count: row.paperPending })}
                    </Link>
                  ) : null}
                  {row.oldestPendingAt
                    ? ` · ${t('gradingOldest', { date: formatWithOptions(row.oldestPendingAt, i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}`
                    : ''}
                </span>
                <Button size="sm" variant="outline" render={<Link to={`/courses/${row.courseId}/grades`} />}>
                  {t('viewGradingQueue')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Khối giảng dạy: phân loại khoá dạy lấy từ PermissionsProvider, còn
 * lưới điểm theo bài toàn lớp tải lười tại khối này qua
 * `useCoursesGradeData` (F-02, rà soát #133 — provider không còn dò
 * dữ liệu điểm khi nạp app). Thẻ "chưa có điểm" là hàng đợi chấm thật
 * — học viên chưa có điểm ở bất kỳ bài nào. Biểu đồ phân bố điểm tính
 * theo từng ô của lưới, chuẩn hoá theo điểm tối đa của bài đó.
 */
export function TeacherSection() {
  const { t } = useTranslation('dashboard');
  const perms = usePermissions();
  const prefs = useCourseCardPrefs();
  const tableLabels = useDataTableLabels();
  const teaching = perms.teaching;
  const gradeData = useCoursesGradeData(teaching.map((c) => c.course.id));
  // `reportOf` bọc `useCallback` (S24) để `useMemo` tính biểu đồ bên
  // dưới dùng được đúng hàm này thay vì đọc thẳng `gradeData` lần nữa.
  const reportOf = useCallback(
    (c: CourseAccess) => gradeData.get(c.course.id)?.report ?? null,
    [gradeData],
  );

  const rows = teaching.flatMap((c) => reportOf(c)?.rows ?? []);
  const graded = rows.filter((r) => Object.values(r.grades).some((g) => g !== null)).length;
  const cards: StatCard[] = [
    {
      id: 'teacher-courses',
      label: t('statTeachingCourses'),
      value: String(teaching.length),
      footer: t('statTeachingFooter'),
    },
    {
      id: 'teacher-students',
      label: t('statMyStudents'),
      value: String(rows.length),
      footer: t('statMyStudentsFooter', { count: graded }),
    },
    {
      id: 'teacher-ungraded',
      label: t('statUngraded'),
      value: String(rows.length - graded),
      footer: t('statUngradedFooter'),
    },
  ];

  const chartData: ChartPoint[] = useMemo(() => {
    const buckets = [
      { label: '0–49%', min: 0, max: 50 },
      { label: '50–64%', min: 50, max: 65 },
      { label: '65–79%', min: 65, max: 80 },
      { label: '80–89%', min: 80, max: 90 },
      { label: '90–100%', min: 90, max: 101 },
    ];
    const counts = buckets.map(() => 0);
    for (const access of teaching) {
      const report = reportOf(access);
      const maxByItem = new Map((report?.items ?? []).map((i) => [i.id, i.gradeMax]));
      for (const row of report?.rows ?? []) {
        for (const [itemId, grade] of Object.entries(row.grades)) {
          if (grade === null) continue;
          const max = maxByItem.get(itemId);
          if (!max || max <= 0) continue;
          const pct = (grade / max) * 100;
          const idx = buckets.findIndex((b) => pct >= b.min && pct < b.max);
          if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
        }
      }
    }
    return buckets.map((b, i) => ({ label: b.label, value: counts[i]! }));
  }, [teaching, reportOf]);

  const columns: DataColumn<CourseAccess>[] = [
    {
      id: 'course',
      header: t('colCourse'),
      cell: (c) => <Link to={`/courses/${c.course.id}`}>{displayCourseName(prefs.data?.get(c.course.id), c.course.fullName)}</Link>,
      sortValue: (c) => c.course.fullName,
    },
    {
      id: 'students',
      header: t('colStudents'),
      cell: (c) => String(reportOf(c)?.rows.length ?? 0),
      sortValue: (c) => reportOf(c)?.rows.length ?? 0,
    },
    {
      id: 'ungraded',
      header: t('colUngraded'),
      cell: (c) => String((reportOf(c)?.rows ?? []).filter((r) => !Object.values(r.grades).some((g) => g !== null)).length),
      sortValue: (c) => (reportOf(c)?.rows ?? []).filter((r) => !Object.values(r.grades).some((g) => g !== null)).length,
    },
    {
      id: 'actions',
      header: t('colActions'),
      cell: (c) => (
        <span className="flex gap-2">
          <Button size="sm" variant="outline" render={<Link to={`/courses/${c.course.id}/grades`} />}>
            {t('viewGradebook')}
          </Button>
          <Button size="sm" variant="outline" render={<Link to={`/courses/${c.course.id}/admin`} />}>
            {t('manageCourse')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-4 md:gap-6" data-testid="dashboard-teacher">
      <SectionHeading title={t('teacherSection')} />
      <TeacherGradingBlock />
      <SectionCards cards={cards} />
      <ChartAreaInteractive
        title={t('chartTeacherTitle')}
        description={t('chartTeacherDescription')}
        seriesLabel={t('chartTeacherSeries')}
        emptyText={t('chartNoData')}
        data={chartData}
      />
      <DataTable
        title={t('tableTeachingTitle')}
        data={teaching}
        columns={columns}
        getRowId={(c) => c.course.id}
        labels={tableLabels}
      />
    </section>
  );
}
