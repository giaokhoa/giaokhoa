import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { apiFetch, errorText } from '#lib/api';
import { appKeyMeta } from '#lib/route-meta';
import { formatDateTime } from '#utils/date-format';
import { courseGroupsQueryOptions, progressReportQueryOptions, useCourseGroups, useProgressReport } from '../queries/progress-report';
import { queryClient } from '#lib/query-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';

/** Trạng thái "chưa hoàn thành" của một mục trong ma trận tiến độ: API trả 0 cho ô chưa xong, khác 0 cho ô đã xong. */
const COMPLETION_STATE_NOT_COMPLETED = 0;

/**
 * Báo cáo tiến độ học cho giáo viên (K2-B4) — ba bề mặt trên một trang:
 * tổng theo mục (mục nào cả lớp kẹt), ma trận lớp × mục (ô = trạng thái hoàn thành), và tổng theo học sinh kèm lần học gần nhất. Lọc được theo lớp/nhóm và tải xuống CSV. Quyền do API thực thi
 * (completion:view/manage của khoá) — học sinh vào trang chỉ thấy
 * thông báo không có quyền.
 */
export function ProgressReportPage() {
  const { t } = useTranslation('app');
  const { id } = useParams();
  const [groupId, setGroupId] = useState('');
  const [csvError, setCsvError] = useState<string | null>(null);
  // Dữ liệu trang qua TanStack (F-01 đợt 1): báo cáo theo khoá + nhóm lọc là một query (đổi nhóm = đổi khoá, keepPreviousData giữ bản cũ trong lúc tải bản mới như luồng thủ công); danh sách nhóm là query riêng. Chỉ 403 mới cho data null → trạng thái không có quyền; lỗi tải khác nổi lên thành lỗi của query để trang hiện thông báo lỗi tải riêng thay vì báo không có quyền.
  const reportQuery = useProgressReport(id, groupId);
  const report = reportQuery.data ?? null;
  const denied = reportQuery.data === null;
  const loadFailed =
    reportQuery.isError && !reportQuery.isFetching
      ? errorText(reportQuery.error, t('progressReportLoadFailed'))
      : null;
  const groupsQuery = useCourseGroups(id);
  const groups = groupsQuery.data ?? [];

  /** Tải CSV qua fetch có xác thực rồi lưu bằng blob URL (đích xuất chuẩn: định dạng `csv` truyền qua tham số truy vấn `format`). */
  async function downloadCsv() {
    if (!id) return;
    setCsvError(null);
    const query = groupId ? `?format=csv&groupId=${encodeURIComponent(groupId)}` : '?format=csv';
    try {
      const res = await apiFetch(`/api/v1/courses/${id}/progress/reports${query}`);
      if (!res.ok) {
        setCsvError(t('progressReportLoadFailed'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'progress-report.csv';
      a.click();
      // Thu hồi URL sau khi trình duyệt đã kịp bắt đầu tải, thay vì thu hồi ngay sau click (file lớn có thể chưa kịp tải).
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setCsvError(errorText(err, t('progressReportLoadFailed')));
    }
  }

  return (
    <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/courses/${id}`} className="text-sm underline">{t('playerBackToCourse')}</Link>
        <h1 className="text-lg font-semibold">{t('progressReportTitle')}</h1>
        {groups.length > 0 ? (
          <Select
            items={Object.fromEntries([
              ['all', t('progressReportAllGroups')],
              ...groups.map((g) => [g.id, g.name] as [string, string]),
            ])}
            value={groupId === '' ? 'all' : groupId}
            onValueChange={(v) => setGroupId(v === 'all' || v === null ? '' : v)}
          >
            <SelectTrigger aria-label={t('progressReportGroupFilter')} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('progressReportAllGroups')}</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {report ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void downloadCsv()}>
            {t('progressReportDownloadCsv')}
          </Button>
        ) : null}
      </div>
      {csvError ? <p role="alert">{csvError}</p> : null}
      {denied ? <p role="alert">{t('progressReportDenied')}</p> : null}
      {loadFailed ? <p role="alert">{loadFailed}</p> : null}
      {report ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('progressReportByItem')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {report.items.map((item) => (
                  <li key={item.cmId}>
                    {item.name} — {t('progressReportItemLine', {
                      done: item.completedCount, total: item.totalStudents, percent: item.percent ?? 0,
                    })}
                  </li>
                ))}
                {report.items.length === 0 ? <li>{t('progressReportEmpty')}</li> : null}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('progressReportMatrix')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">{t('progressReportStudent')}</th>
                    {report.items.map((item) => (
                      <th key={item.cmId} className="text-left">{item.name}</th>
                    ))}
                    <th className="text-left">{t('progressReportPercentColumn')}</th>
                    <th className="text-left">{t('progressReportLastAccess')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.students.map((student) => (
                    <tr key={student.userId}>
                      <td>{student.fullName || student.username}</td>
                      {report.items.map((item) => (
                        <td key={item.cmId}>{(student.states[item.cmId] ?? COMPLETION_STATE_NOT_COMPLETED) !== COMPLETION_STATE_NOT_COMPLETED ? '✓' : '—'}</td>
                      ))}
                      <td>{student.percent !== null ? `${student.percent}%` : '—'}</td>
                      <td>{student.lastAccessAt ? formatDateTime(student.lastAccessAt) : '—'}</td>
                    </tr>
                  ))}
                  {report.students.length === 0 ? (
                    <tr><td>{t('progressReportEmpty')}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
      {!report && !denied && !loadFailed ? <p>{t('courseLoading')}</p> : null}
    </main>
  );
}

/** Route module là chính trang này (src/routes.ts trỏ thẳng vào file): cần default export để framework mode coi đây là route có component — thiếu nó, request tài liệu phía server bị xếp vào resource route và trả 400 (GĐ4 của issue #7 phát hiện khi rà SSR toàn bộ route). */
export default ProgressReportPage;

/**
 * clientLoader (F-01 đợt 1 + bổ sung clientLoader, rà soát #133):
 * prefetch báo cáo (chưa lọc nhóm) + danh sách nhóm vào QueryClient
 * singleton dùng chung, đúng khoá factory, trước khi component mount.
 */
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.id) {
    await Promise.all([
      queryClient.prefetchQuery(progressReportQueryOptions(params.id, '')),
      queryClient.prefetchQuery(courseGroupsQueryOptions(params.id)),
    ]);
  }
  return null;
}

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
export function meta() {
  return appKeyMeta('progressReportTitle');
}
