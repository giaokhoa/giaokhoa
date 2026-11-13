import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoaderData } from 'react-router';
import '#config/i18n';
import type { HealthStatus } from '@giaokhoa/contracts';
import { healthStatusSchema } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { PageHeader, PageShell } from '#components/page-shell';
import { fetchApiJson } from '#lib/server-api';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; health: HealthStatus };

export async function loader(): Promise<{ health: HealthStatus | null }> {
  const body = await fetchApiJson('/api/v1/health');
  const parsed = healthStatusSchema.safeParse(body);
  return { health: parsed.success ? parsed.data : null };
}

export function HealthPage({ initialHealth }: { initialHealth?: HealthStatus | null } = {}) {
  const { t } = useTranslation('app');
  const [state, setState] = useState<State>(() =>
    initialHealth ? { kind: 'ready', health: initialHealth } : { kind: 'loading' },
  );
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealthState = useCallback(async (): Promise<State> => {
    try {
      const res = await fetch('/api/v1/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const health = (await res.json()) as HealthStatus;
      return { kind: 'ready', health };
    } catch (error: unknown) {
      return {
        kind: 'error',
        message: error instanceof Error ? error.message : t('unknownError'),
      };
    }
  }, [t]);

  const loadHealth = useCallback(async (): Promise<void> => {
    setState(await fetchHealthState());
  }, [fetchHealthState]);

  useEffect(() => {
    if (initialHealth) return;
    let active = true;
    void fetchHealthState().then((next) => {
      if (active) setState(next);
    });
    return () => { active = false; };
  }, [initialHealth, fetchHealthState]);

  const reload = async () => {
    setRefreshing(true);
    try {
      await loadHealth();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PageShell width="narrow">
      <PageHeader title={t('healthTitle')} description={t('healthDescription')} />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing || state.kind === 'loading'}
          onClick={() => void reload()}
        >
          {t('checkApiHealth')}
        </Button>
      </div>
      <Card>
        <CardContent>
          {state.kind === 'loading' && (
            <PageSkeleton label={t('loading')} rows={['h-4 w-40', 'h-4 w-56', 'h-4 w-48']} />
          )}
          {state.kind === 'error' && (
            <ErrorAlert variant="destructive" title={t('healthTitle')}>
              {t('healthLoadFailed', { message: state.message })}
            </ErrorAlert>
          )}
          {state.kind === 'ready' && (
            <dl className="space-y-2">
              <div>
                <dt className="font-medium">{t('status')}</dt>
                <dd>{state.health.status}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('database')}</dt>
                <dd>{state.health.checks.database}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('redis')}</dt>
                <dd>{state.health.checks.redis}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('timestamp')}</dt>
                <dd>{state.health.timestamp}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default function HealthRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <HealthPage initialHealth={loaderData?.health ?? null} />;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navHealth');
}
