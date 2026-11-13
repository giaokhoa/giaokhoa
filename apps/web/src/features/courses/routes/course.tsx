import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CourseContent } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { courseConversationQueryOptions } from '#features/messaging/queries/messaging';
import { coursePageQueryOptions, myPaymentsQueryOptions, useCoursePage, useMyPayments, usePayFee, useSelfEnrol, useToggleManualCompletion } from '../queries/course';
import { queryClient } from '#lib/query-client';

type CourseModuleView = CourseContent['sections'][number]['modules'][number];

function allowsManualCompletion(cm: CourseModuleView): boolean {
  return cm.completion !== 0 && (cm.completionManual === true || cm.completion === 1);
}

export function CoursePage() {
  const { t } = useTranslation('app');
  const { id } = useParams();
  const navigate = useNavigate();
  const pageQuery = useCoursePage(id);
  const page = pageQuery.data;
  const course = page?.course ?? null;
  const content = page?.content ?? null;
  const enrolment = page?.enrolment ?? null;
  const instances = page?.instances ?? [];
  const completion = page?.completion ?? null;
  const progress = page?.progress ?? null;
  const classMarkers = page?.classMarkers ?? null;
  const { payments } = useMyPayments();
  const selfEnrolMutation = useSelfEnrol(id);
  const payFeeMutation = usePayFee();
  const toggleMutation = useToggleManualCompletion(id);
  const busyInstanceId = selfEnrolMutation.isPending
    ? (selfEnrolMutation.variables ?? null)
    : payFeeMutation.isPending
      ? (payFeeMutation.variables ?? null)
      : null;
  const busyCmId = toggleMutation.isPending ? (toggleMutation.variables?.cmId ?? null) : null;
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);

  async function openClassChat() {
    setChatBusy(true);
    setChatError(null);
    try {
      const conv = await queryClient.fetchQuery(courseConversationQueryOptions(id ?? ''));
      navigate(`/messages?conversation=${conv.id}`);
    } catch {
      setChatError(t('courseChatOpenFailed'));
    } finally {
      setChatBusy(false);
    }
  }

  async function selfEnrol(instanceId: string) {
    setActionError(null);
    setMessage(null);
    try {
      await selfEnrolMutation.mutateAsync(instanceId);
      setMessage(t('enrolSuccess'));
    } catch {
      setActionError(t('enrolFailed'));
    }
  }

  async function payFee(instanceId: string) {
    setActionError(null);
    setMessage(null);
    try {
      await payFeeMutation.mutateAsync(instanceId);
      setMessage(t('enrolPaymentCreated'));
    } catch {
      setActionError(t('enrolPaymentFailed'));
    }
  }

  async function toggleManualCompletion(cmId: string, complete: boolean) {
    const userId = enrolment?.userId ?? completion?.course.userId;
    if (!userId) {
      setCompletionError(t('completionMarkFailed'));
      return;
    }
    setCompletionError(null);
    try {
      await toggleMutation.mutateAsync({ cmId, userId, complete });
    } catch {
      setCompletionError(t('completionMarkFailed'));
    }
  }

  if (pageQuery.isPending)
    return (
      <PageShell width="wide">
        <PageSkeleton className="space-y-3" label={t('courseLoading')} rows={['h-8 w-72', 'h-28 w-full', 'h-28 w-full']} />
      </PageShell>
    );

  const isEnrolledActive = enrolment?.enrolled === true && enrolment?.active === true;

  if (content) {
    const completionByCm = new Map((completion?.activities ?? []).map((a) => [a.cmId, a]));
    const sectionProgress = new Map((progress?.sections ?? []).map((s) => [s.sectionId, s]));
    const markerNamesByCm = new Map<string, string[]>();
    for (const marker of classMarkers?.markers ?? []) {
      if (!marker.markerCmId) continue;
      markerNamesByCm.set(marker.markerCmId, [...(markerNamesByCm.get(marker.markerCmId) ?? []), marker.groupName]);
    }
    return (
      <PageShell width="wide">
        <PageHeader
          title={content.course.fullName}
          description={`${content.course.shortName}${content.course.visible ? '' : ` ${t('hiddenCourseSuffix')}`}`}
        />
        {progress && progress.percent !== null ? (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{t('courseProgressLabel', { percent: progress.percent })}</span>
              <span className="text-sm text-muted-foreground">
                {t('courseProgressDetail', { completed: progress.completed, total: progress.total })}
              </span>
              {progress.resume ? (
                <Link to={`/courses/${id}/learn/${progress.resume.cmId}`}>
                  <Button type="button" size="sm">{t('learnContinue')}</Button>
                </Link>
              ) : null}
              {(() => {
                const weakest = [...progress.sections]
                  .filter((s) => s.percent !== null && s.percent < 100)
                  .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))[0];
                const target = weakest?.items.find((i) => i.completion !== 0 && !i.done);
                return target && target.cmId !== progress.resume?.cmId ? (
                  <Link to={`/courses/${id}/learn/${target.cmId}`} className="text-sm underline">
                    {t('reviewWeakest')}
                  </Link>
                ) : null;
              })()}
              <Link to={`/courses/${id}/progress`} className="text-sm underline">
                {t('progressReportLink')}
              </Link>
            </CardContent>
          </Card>
        ) : null}
        {isEnrolledActive ? <p className="text-sm text-muted-foreground">{t('enrolledNotice')}</p> : null}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t('courseChatOpen')}</span>
            <Button type="button" size="sm" disabled={chatBusy} onClick={() => void openClassChat()}>
              {t('courseChatOpen')}
            </Button>
            {chatError ? (
              <span role="alert" className="text-sm text-destructive">
                {chatError}
              </span>
            ) : null}
          </CardContent>
        </Card>
        {completionError ? (
          <ErrorAlert variant="destructive">
            {completionError}
          </ErrorAlert>
        ) : null}
        {content.sections.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle>
                {section.name ?? t('sectionDefaultName', { number: section.section })}
                {sectionProgress.get(section.id)?.percent != null ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {t('courseProgressLabel', { percent: sectionProgress.get(section.id)!.percent! })}
                  </span>
                ) : null}
              </CardTitle>
              {section.availabilityResult && !section.availabilityResult.available && (
                <CardDescription>
                  {t('sectionRestricted', { reasons: section.availabilityResult.failedDescriptions.join('; ') })}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {section.frame ? (
                <div className="mb-3 rounded border border-dashed p-3">
                  <p className="text-sm font-medium">{t('courseFrameOutcomes')}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {section.frame.outcomes.map((outcome, index) => (
                      <li key={outcome.outcomeId ?? `frame-outcome-${index}`}>{outcome.content}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {section.bookFrame ? (
                <div className="mb-3 rounded border border-dashed p-3">
                  <p className="text-sm font-medium">{t('courseBookFrameItems')}</p>
                  <ul className="mt-1 space-y-2 text-sm">
                    {section.bookFrame.items.map((item, index) => (
                      <li key={item.nodeId ?? `book-item-${index}`}>
                        <span className="font-medium">{item.title}</span>
                        {item.outcomes.length > 0 ? (
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
                            {item.outcomes.map((outcome, outcomeIndex) => (
                              <li key={outcome.outcomeId ?? `book-outcome-${outcomeIndex}`}>{outcome.content}</li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <ul className="space-y-2">
                {section.modules.map((rawCm) => {
                  const cm = rawCm as CourseModuleView;
                  const result = cm.availabilityResult;
                  const locked = result !== undefined && !result.available;
                  const activity = completionByCm.get(cm.id);
                  const isComplete = (activity?.state ?? 0) >= 1;
                  const showManual = completion !== null && allowsManualCompletion(cm);
                  return (
                    <li
                      key={cm.id}
                      data-testid={`cm-${cm.id}`}
                      aria-disabled={locked || undefined}
                      className={locked ? 'opacity-50' : undefined}
                    >
                      {isComplete ? <span aria-label={t('completionCompleted')}>✓ </span> : null}
                      {cm.component === 'mod_quiz' && cm.instanceId && !locked ? (
                        <Link to={`/courses/${id}/exams/${cm.instanceId}`}>{cm.name || cm.component}</Link>
                      ) : cm.component === 'mod_assign' && cm.instanceId && !locked ? (
                        <Link to={`/courses/${id}/assignments/${cm.instanceId}`}>{cm.name || cm.component}</Link>
                      ) : (cm.component === 'mod_page' || cm.component === 'mod_resource') && !locked ? (
                        <Link to={`/courses/${id}/learn/${cm.id}`}>{cm.name || cm.component}</Link>
                      ) : (
                        <span>{cm.name || cm.component}</span>
                      )}
                      {(markerNamesByCm.get(cm.id) ?? []).map((groupName) => (
                        <span key={groupName} className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {t('classMarkerBadge', { name: groupName })}
                        </span>
                      ))}
                      {locked && (
                        <span role="note">
                          {' '}
                          {t('lockedSuffix', {
                            reasons: result.failedDescriptions.length
                              ? result.failedDescriptions.join('; ')
                              : t('notAvailableYet'),
                          })}
                        </span>
                      )}
                      {!locked && result && <span> {t('availableSuffix')}</span>}
                      {showManual && (
                        <span className="ml-3 inline-flex items-center gap-2">
                          <span>{isComplete ? t('completionCompleted') : t('completionIncomplete')}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyCmId === cm.id}
                            onClick={() => void toggleManualCompletion(cm.id, !isComplete)}
                          >
                            {isComplete ? t('completionMarkIncomplete') : t('completionMarkComplete')}
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {section.modules.length === 0 ? (
                <Empty className="p-4">
                  <EmptyHeader>
                    <EmptyTitle>{t('noActivities')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </PageShell>
    );
  }

  const enrolOptions = instances.filter((i) => i.status === 0 && (i.enrol === 'self' || i.enrol === 'fee'));
  const headerCourse = course;
  return (
    <PageShell width="wide">
      <PageHeader
        title={headerCourse ? headerCourse.fullName : t('enrolPanelTitle')}
        description={
          headerCourse
            ? `${headerCourse.shortName}${headerCourse.visible ? '' : ` ${t('hiddenCourseSuffix')}`}`
            : undefined
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <p>{t('enrolPanelDescription')}</p>
          {message ? (
            <ErrorAlert>
              {message}
            </ErrorAlert>
          ) : null}
          {actionError ? (
            <ErrorAlert variant="destructive">
              {actionError}
            </ErrorAlert>
          ) : null}
          {enrolOptions.length === 0 ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyTitle>{t('enrolNoOptions')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}
          <ul className="space-y-3" aria-label={t('enrolPanelTitle')}>
            {enrolOptions.map((instance) => {
              const myPayments = payments.filter((p) => p.itemId === instance.id);
              const latestPayment = myPayments[myPayments.length - 1];
              return (
                <li key={instance.id} className="rounded border p-3" data-testid={`enrol-instance-${instance.id}`}>
                  <p className="font-medium">{instance.name ?? t('enrolInstanceFallback')}</p>
                  {instance.enrol === 'self' ? (
                    <>
                      <p className="text-sm text-muted-foreground">{t('enrolSelfDescription')}</p>
                      <Button
                        type="button"
                        disabled={busyInstanceId === instance.id}
                        onClick={() => void selfEnrol(instance.id)}
                      >
                        {busyInstanceId === instance.id ? t('enrolProcessing') : t('enrolSelfAction')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{t('enrolFeeDescription')}</p>
                      <p>
                        {t('enrolFeeLine', { amount: instance.cost.toLocaleString(), currency: instance.currency })}
                      </p>
                      <Button
                        type="button"
                        disabled={busyInstanceId === instance.id}
                        onClick={() => void payFee(instance.id)}
                      >
                        {busyInstanceId === instance.id ? t('enrolProcessing') : t('enrolPayAction')}
                      </Button>
                      {latestPayment ? (
                        <div className="mt-2 space-y-1 text-sm">
                          <p>
                            {t('enrolPaymentLine', {
                              amount: latestPayment.amount.toLocaleString(),
                              currency: latestPayment.currency,
                              status: t(
                                latestPayment.status === 'pending'
                                  ? 'paymentStatusPending'
                                  : latestPayment.status === 'succeeded'
                                    ? 'paymentStatusSucceeded'
                                    : latestPayment.status === 'refunded'
                                      ? 'paymentStatusRefunded'
                                      : 'paymentStatusFailed',
                              ),
                            })}
                          </p>
                          {latestPayment.status === 'pending' ? <p>{t('enrolPaymentWaiting')}</p> : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {enrolOptions.length === 0 && !headerCourse ? (
            <ErrorAlert variant="destructive">
              {t('courseAccessDenied')}
            </ErrorAlert>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default CoursePage;

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.id) {
    await Promise.all([
      queryClient.prefetchQuery(coursePageQueryOptions(params.id)),
      queryClient.prefetchQuery(myPaymentsQueryOptions()),
    ]);
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navCourses');
}
