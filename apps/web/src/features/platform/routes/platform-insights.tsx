import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { PageHeader, PageShell } from '#components/page-shell';
import { useMyInsights } from '../queries/platform';

export function InsightsPage() {
  const { t: t } = useTranslation();
  const insightsQuery = useMyInsights();
  const insights = insightsQuery.data ?? [];
  const loading = insightsQuery.isPending || (insightsQuery.isError && insightsQuery.isFetching);
  const loadError = insightsQuery.isError && !insightsQuery.isFetching ? t('insightsLoadFailed') : null;
  return (
    <PageShell width="medium">
      <PageHeader title={t('insightsTitle')} />
      {loadError ? (
        <>
          <ErrorAlert variant="destructive">
            {loadError}
          </ErrorAlert>
          <div>
            <Button type="button" variant="outline" onClick={() => void insightsQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        </>
      ) : null}
      <Card>
        <CardContent>
          {loading ? (
            <PageSkeleton label={t('loading')} rows={['h-10 w-full', 'h-10 w-full']} />
          ) : (
            <>
              <ul aria-label={t('insightsTitle')} className="space-y-2">
                {insights.map((i) => (
                  <li key={i.id} className="rounded border p-2">
                    <p className="font-medium">{i.heading}</p>
                    <p className="text-sm">
                      Student {i.userId} · course {i.courseId}
                    </p>
                  </li>
                ))}
              </ul>
              {insights.length === 0 ? (
                <Empty className="p-6">
                  <EmptyHeader>
                    <EmptyTitle>{t('noInsights')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export { InsightsPage as default };

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { platformKeyMeta } from '#lib/route-meta';
export function meta() {
  return platformKeyMeta('insightsTitle');
}

export { insightsPageClientLoader as clientLoader } from '../queries/platform';
