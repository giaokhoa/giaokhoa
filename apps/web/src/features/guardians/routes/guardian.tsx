import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import type { GuardianDigestFrequency } from '@giaokhoa/contracts';
import '#config/i18n';
import { guardianDigestPreferenceQueryOptions, guardianMyStudentsQueryOptions, guardianOverviewQueryOptions, guardianResultsQueryOptions, useUpdateGuardianDigestPreference } from '../queries/guardians';
import { formatWithOptions } from '#utils/date-format';
import { SectionCards, type StatCard } from '#components/section-cards';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { PageSkeleton } from '#components/page-skeleton';
import { PageShell } from '#components/page-shell';

function studentName(s: { firstName: string; lastName: string }): string {
  return `${s.lastName} ${s.firstName}`.trim();
}


function scoreLabel(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function BlockTitle({ children }: { children: string }) {
  return <h2 className="px-4 text-lg font-semibold lg:px-6">{children}</h2>;
}

function DigestSettings({ studentId }: { studentId: string }) {
  const { t } = useTranslation('guardian');
  const preferenceQuery = useQuery(guardianDigestPreferenceQueryOptions(studentId));
  const mutation = useUpdateGuardianDigestPreference(studentId);
  const current = preferenceQuery.data?.frequency ?? 'weekly';
  const options: { value: GuardianDigestFrequency; label: string }[] = [
    { value: 'weekly', label: t('digestWeekly') },
    { value: 'daily', label: t('digestDaily') },
    { value: 'off', label: t('digestOff') },
  ];
  return (
    <section className="flex flex-col gap-3">
      <BlockTitle>{t('digestTitle')}</BlockTitle>
      <div className="px-4 lg:px-6">
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-sm text-muted-foreground">{t('digestDescription')}</p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('digestTitle')}>
              {options.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={current === option.value ? 'default' : 'outline'}
                  aria-pressed={current === option.value}
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {mutation.isError && <p className="text-sm text-destructive">{t('digestError')}</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export function GuardianPage() {
  const { t, i18n } = useTranslation('guardian');
  const locale = i18n.language;

  const studentsQuery = useQuery(guardianMyStudentsQueryOptions());
  const students = studentsQuery.data ?? [];
  const params = useParams();
  const routeStudentId = params.studentId ?? null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const legacyStudentId = searchParams.get('student');
  const studentsSettled = studentsQuery.isSuccess;
  const routeStudentLinked = routeStudentId !== null && students.some((s) => s.student.id === routeStudentId);
  const studentId = routeStudentLinked ? routeStudentId : students[0]?.student.id;

  const overviewQuery = useQuery({
    ...guardianOverviewQueryOptions(studentId ?? ''),
    enabled: !!studentId,
  });
  const resultsQuery = useQuery({
    ...guardianResultsQueryOptions(studentId ?? ''),
    enabled: !!studentId,
  });
  const overview = overviewQuery.data;
  const results = resultsQuery.data;

  const weeklyCards: StatCard[] = overview
    ? [
        { id: 'due', label: t('statDue'), value: String(overview.weekly.dueThisWeek) },
        { id: 'submitted', label: t('statSubmitted'), value: String(overview.weekly.submitted) },
        { id: 'not-submitted', label: t('statNotSubmitted'), value: String(overview.weekly.notSubmitted) },
        { id: 'overdue', label: t('statOverdue'), value: String(overview.weekly.overdue) },
      ]
    : [];

  if (studentsSettled && !routeStudentId && legacyStudentId) {
    const legacyLinked = students.some((s) => s.student.id === legacyStudentId);
    return <Navigate to={legacyLinked ? `/guardian/students/${legacyStudentId}` : '/guardian'} replace />;
  }
  if (studentsSettled && routeStudentId && !routeStudentLinked) {
    return <Navigate to="/guardian" replace />;
  }

  return (
    <PageShell width="wide" className="px-0 lg:px-0">
      <div className="flex flex-col gap-2 px-4 lg:px-6">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {studentsQuery.isPending ? (
        <PageSkeleton className="flex flex-col gap-4 px-4 lg:px-6" testId="guardian-loading" rows={['h-24 w-full', 'h-48 w-full']} />
      ) : students.length === 0 ? (
        <div className="px-4 lg:px-6">
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">{t('noChildren')}</CardContent>
          </Card>
        </div>
      ) : (
        <>
          {students.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6" role="group" aria-label={t('chooseChild')}>
              {students.map((entry) => (
                <Button
                  key={entry.student.id}
                  type="button"
                  variant={entry.student.id === studentId ? 'default' : 'outline'}
                  aria-pressed={entry.student.id === studentId}
                  onClick={() => navigate(`/guardian/students/${entry.student.id}`)}
                >
                  {studentName(entry.student)}
                </Button>
              ))}
            </div>
          )}
          {students.length === 1 && (
            <p className="px-4 text-base font-medium lg:px-6">{studentName(students[0]!.student)}</p>
          )}

          {studentId && <DigestSettings studentId={studentId} />}

          {overviewQuery.isError || resultsQuery.isError ? (
            <p className="px-4 text-sm text-destructive lg:px-6">{t('loadError')}</p>
          ) : !overview || !results ? (
            <PageSkeleton className="flex flex-col gap-4 px-4 lg:px-6" testId="guardian-loading" rows={['h-24 w-full', 'h-48 w-full']} />
          ) : (
            <>
              <section className="flex flex-col gap-3">
                <BlockTitle>{t('weeklyTitle')}</BlockTitle>
                <p className="-mt-2 px-4 text-sm text-muted-foreground lg:px-6">
                  {t('weeklyRange', { start: formatWithOptions(overview.weekly.weekStart, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }), end: formatWithOptions(overview.weekly.weekEnd, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) })}
                </p>
                <SectionCards cards={weeklyCards} />
                <div className="px-4 lg:px-6">
                  <Card>
                    <CardContent className="py-4">
                      {overview.weekly.items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('weeklyEmpty')}</p>
                      ) : (
                        <ul className="flex flex-col divide-y">
                          {overview.weekly.items.map((item) => (
                            <li key={item.cmId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                              <Badge variant={item.status === 'overdue' ? 'destructive' : 'secondary'}>
                                {item.status === 'overdue'
                                  ? t('statusOverdue')
                                  : item.status === 'submitted'
                                    ? t('statusSubmitted')
                                    : t('statusNotSubmitted')}
                              </Badge>
                              <span className="font-medium">{item.name}</span>
                              <span className="text-muted-foreground">
                                {item.kind === 'quiz' ? t('kindQuiz') : t('kindAssignment')} · {item.courseName}
                              </span>
                              <span className="ml-auto text-muted-foreground">{t('dueAt', { date: formatWithOptions(item.dueAt, locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <BlockTitle>{t('newResultsTitle')}</BlockTitle>
                <div className="px-4 lg:px-6">
                  <Card>
                    <CardContent className="py-4">
                      {overview.newResults.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('newResultsEmpty')}</p>
                      ) : (
                        <ul className="flex flex-col divide-y">
                          {overview.newResults.map((r, idx) => (
                            <li key={`${r.courseId}-${r.itemId ?? r.kind}-${idx}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                              <span className="font-medium">
                                {r.itemName}
                              </span>
                              <span className="text-muted-foreground">{r.courseName}</span>
                              {r.finalGrade !== null && r.gradeMax !== null && (
                                <span className="ml-auto font-medium">
                                  {t('newResultGrade', { grade: scoreLabel(r.finalGrade, locale), max: scoreLabel(r.gradeMax, locale) })}
                                </span>
                              )}
                              {r.feedback && <span className="w-full text-muted-foreground">{r.feedback}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <BlockTitle>{t('announcementsTitle')}</BlockTitle>
                <div className="px-4 lg:px-6">
                  <Card>
                    <CardContent className="py-4">
                      {overview.announcements.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('announcementsEmpty')}</p>
                      ) : (
                        <ul className="flex flex-col divide-y">
                          {overview.announcements.map((a) => (
                            <li key={a.id} className="py-2 text-sm">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-medium">{a.subject}</span>
                                <span className="text-muted-foreground">{a.courseName}</span>
                                <span className="ml-auto text-muted-foreground">{formatWithOptions(a.createdAt, locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <p className="text-muted-foreground">{a.body}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <BlockTitle>{t('progressTitle')}</BlockTitle>
                <div className="px-4 lg:px-6">
                  <Card>
                    <CardContent className="flex flex-col gap-4 py-4">
                      {overview.courseProgress.map((p) => (
                        <div key={p.courseId} className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-baseline gap-2 text-sm">
                            <span className="font-medium">{p.courseName}</span>
                            <span className="ml-auto text-muted-foreground">
                              {p.percent === null
                                ? t('progressNotTracked')
                                : `${t('progressLine', { completed: p.completed, total: p.total })} · ${p.percent}%`}
                            </span>
                          </div>
                          {p.percent !== null && (
                            <div className="h-2 w-full rounded bg-muted" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
                              <div className="h-2 rounded bg-primary" style={{ width: `${p.percent}%` }} />
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <BlockTitle>{t('resultsTitle')}</BlockTitle>
                <div className="flex flex-col gap-4 px-4 lg:px-6">
                  {results.courses.length === 0 ? (
                    <Card>
                      <CardContent className="py-4 text-sm text-muted-foreground">{t('resultsEmpty')}</CardContent>
                    </Card>
                  ) : (
                    results.courses.map((course) => (
                      <Card key={course.courseId}>
                        <CardHeader>
                          <CardTitle className="text-base">{course.courseName}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2 text-sm">
                          {course.activities.map((activity) => (
                            <div key={activity.itemId} className="flex flex-wrap items-baseline gap-2 border-b pb-2 last:border-0">
                              <span className="font-medium">{activity.itemName}</span>
                              <span className="ml-auto font-medium">
                                {activity.finalGrade !== null
                                  ? t('newResultGrade', { grade: scoreLabel(activity.finalGrade, locale), max: scoreLabel(activity.gradeMax, locale) })
                                  : '—'}
                              </span>
                              {activity.feedback && <span className="w-full text-muted-foreground">{activity.feedback}</span>}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

export default GuardianPage;

export { guardianPageClientLoader as clientLoader } from '../queries/guardians';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { guardianKeyMeta } from '#lib/route-meta';
export function meta() {
  return guardianKeyMeta('title');
}
