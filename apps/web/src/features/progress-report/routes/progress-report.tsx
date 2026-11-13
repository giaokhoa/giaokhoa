import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { apiFetch } from '#lib/api';
import { formatDateTime } from '#utils/date-format';
import { courseGroupsQueryOptions, progressReportQueryOptions, useCourseGroups, useProgressReport } from '../queries/progress-report';
import { queryClient } from '#lib/query-client';

export function ProgressReportPage() {
  const { t } = useTranslation('app');
  const { id } = useParams();
  const [groupId, setGroupId] = useState('');
  const reportQuery = useProgressReport(id, groupId);
  const report = reportQuery.data ?? null;
  const denied = reportQuery.data === null;
  const groupsQuery = useCourseGroups(id);
  const groups = groupsQuery.data ?? [];

  async function downloadCsv() {
    if (!id) return;
    const query = groupId ? `?format=csv&groupId=${groupId}` : '?format=csv';
    const res = await apiFetch(`/api/v1/courses/${id}/progress/reports${query}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'progress-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/courses/${id}`} className="text-sm underline">{t('playerBackToCourse')}</Link>
        <h1 className="text-lg font-semibold">{t('progressReportTitle')}</h1>
        {groups.length > 0 ? (
          <select
            className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            aria-label={t('progressReportGroupFilter')}
          >
            <option value="">{t('progressReportAllGroups')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        ) : null}
        {report ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void downloadCsv()}>
            {t('progressReportDownloadCsv')}
          </Button>
        ) : null}
      </div>
      {denied ? <p role="alert">{t('progressReportDenied')}</p> : null}
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
                        <td key={item.cmId}>{(student.states[item.cmId] ?? 0) !== 0 ? '✓' : '—'}</td>
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
      {!report && !denied ? <p>{t('courseLoading')}</p> : null}
    </main>
  );
}

export default ProgressReportPage;

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.id) {
    await Promise.all([
      queryClient.prefetchQuery(progressReportQueryOptions(params.id, '')),
      queryClient.prefetchQuery(courseGroupsQueryOptions(params.id)),
    ]);
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tiến độ học tập');
}
