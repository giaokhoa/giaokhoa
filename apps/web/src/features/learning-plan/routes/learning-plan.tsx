import { useState } from 'react';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useAuth } from '#lib/auth';
import { usePermissions } from '#lib/permissions';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '#components/data-table';
import { CompetencyAdmin } from '../components/competency-admin';
import { type PlanDetail, type PlanView } from '../types/types';
import { PageHeader, PageShell } from '#components/page-shell';
import { useLearningPlanDetail, useRequestCompetencyReview, useRequestPlanReview, useUserLearningPlans } from '../queries/learning-plan';
import '#config/i18n';

export function LearningPlanPage() {
  const { t } = useTranslation('app');
  const PLAN_STATUS: Record<number, string> = {
    0: t('planStatusDraft'),
    1: t('planStatusActive'),
    2: t('planStatusWaiting'),
    3: t('planStatusInReview'),
    4: t('planStatusComplete'),
  };
  const REVIEW_STATUS: Record<number, string> = {
    0: t('reviewStatusNone'),
    1: t('reviewStatusWaiting'),
    2: t('reviewStatusInReview'),
  };
  const { user } = useAuth();
  const perms = usePermissions();
  const plansQuery = useUserLearningPlans(user?.id);
  const plans = plansQuery.data ?? [];
  const [selectedPlan, setSelectedPlan] = useState<PlanView | null>(null);
  const detailQuery = useLearningPlanDetail(selectedPlan?.id ?? null);
  const detail = detailQuery.data ?? null;
  const requestPlanReview = useRequestPlanReview();
  const requestCompetencyReviewMutation = useRequestCompetencyReview();
  const planCompetencyColumns: DataColumn<PlanDetail['competencies'][number]>[] = [
    {
      id: 'competency',
      header: t('competency'),
      cell: (row) => row.competency.shortName,
      sortValue: (row) => row.competency.shortName,
      filterValue: (row) => row.competency.shortName,
    },
    {
      id: 'proficiency',
      header: t('proficiency'),
      cell: (row) =>
        row.usercomp?.proficiency == null
          ? t('proficiencyNotYet')
          : row.usercomp.proficiency
            ? t('proficiencyYes')
            : t('proficiencyNo'),
      sortValue: (row) => (row.usercomp?.proficiency == null ? -1 : row.usercomp.proficiency ? 1 : 0),
    },
    {
      id: 'review',
      header: t('review'),
      cell: (row) => (row.usercomp ? (REVIEW_STATUS[row.usercomp.status] ?? row.usercomp.status) : '—'),
    },
    {
      id: 'actions',
      header: '',
      cell: (row) =>
        row.usercomp && row.usercomp.status === 0 ? (
          <Button type="button" variant="outline" onClick={() => void requestCompetencyReview(row.usercomp!.id)}>
            {t('sendForReview')}
          </Button>
        ) : null,
    },
  ];
  const [message, setMessage] = useState<string | null>(null);
  const loading = plansQuery.isPending || (plansQuery.isError && plansQuery.isFetching);
  const error = plansQuery.isError && !plansQuery.isFetching ? t('plansLoadFailed') : null;

  function open(plan: PlanView) {
    setSelectedPlan(plan);
  }

  async function requestReview(planId: string) {
    if (!user) return;
    await requestPlanReview.mutateAsync({ planId, userId: user.id });
    setMessage(t('reviewRequested'));
  }

  async function requestCompetencyReview(usercompId: string) {
    if (!detail) return;
    await requestCompetencyReviewMutation.mutateAsync({
      usercompId,
      planId: detail.plan.id,
      description: t('evidenceReviewDescription'),
    });
    setMessage(t('competencySentForReview'));
  }

  return (
    <PageShell width="wide">
      <PageHeader title={t('myLearningPlans')} />
      {error ? (
        <>
          <ErrorAlert variant="destructive">
            {error}
          </ErrorAlert>
          <div>
            <Button type="button" variant="outline" onClick={() => void plansQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        </>
      ) : null}
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardContent className="space-y-2">
          {loading ? (
            <PageSkeleton label={t('loading')} rows={['h-8 w-full', 'h-8 w-full']} />
          ) : (
            <>
              <ul className="space-y-1" aria-label={t('learningPlansLabel')}>
                {plans.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span>{PLAN_STATUS[p.status] ?? p.status}</span>
                    <Button type="button" variant="outline" onClick={() => open(p)}>
                      {t('view')}
                    </Button>
                    {p.status === 1 ? (
                      <Button type="button" variant="outline" onClick={() => void requestReview(p.id)}>
                        {t('requestPlanReview')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {plans.length === 0 ? (
                <Empty className="p-6">
                  <EmptyHeader>
                    <EmptyTitle>{t('noLearningPlans')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      {detail ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('planCompetenciesTitle', { name: detail.plan.name })}</CardTitle>
          </CardHeader>
          <DataTable
            data={detail.competencies}
            columns={planCompetencyColumns}
            labels={{
              columns: t('dashboard:tableColumns'),
              previous: t('dashboard:tablePrevious'),
              next: t('dashboard:tableNext'),
              empty: t('dashboard:emptyTable'),
              filterPlaceholder: t('dashboard:tableFilterPlaceholder'),
              pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
            }}
            getRowId={(row) => row.competency.id}
          />
        </Card>
      ) : null}
      {perms.canAdminister ? <CompetencyAdmin /> : null}
    </PageShell>
  );
}

export default LearningPlanPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navLearningPlan');
}
