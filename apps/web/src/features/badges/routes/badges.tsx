import { useState, type FormEvent } from 'react';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { formatDate } from '#utils/date-format';
import { usePermissions } from '#lib/permissions';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { useAllBadges, useBadgeIssued, useCreateBadge, useMyBadges, useSetBadgeCriteria, useSetBadgeStatus } from '../queries/badges';
import type { BadgeView, MyBadgeView } from '../types/badges';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as badgesQueryKeys } from '../queries/keys';
import { buildSsrLoaderData, serverQueryFn, type SsrLoaderData } from '#lib/ssr-data';

export async function loader({ request }: { request: Request }): Promise<SsrLoaderData> {
  return buildSsrLoaderData(request, async (queryClient, req) => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.myBadges,
        queryFn: serverQueryFn<MyBadgeView[]>(req, '/api/v1/badges/mine'),
      }),
      queryClient.prefetchQuery({
        queryKey: badgesQueryKeys.badgesAll,
        queryFn: serverQueryFn<BadgeView[]>(req, '/api/v1/badges'),
      }),
    ]);
  });
}

export function BadgesPage() {
  const { t } = useTranslation('app');
  const STATUS_LABEL: Record<number, string> = {
    0: t('badgeStatusInactive'),
    1: t('badgeStatusActive'),
    2: t('badgeStatusRetired'),
    3: t('badgeStatusArchived'),
    4: t('badgeStatusDisabled'),
  };
  const { canAdminister } = usePermissions();
  const [name, setName] = useState('');
  const [criteriaBadgeId, setCriteriaBadgeId] = useState('');
  const [criteriaCourseId, setCriteriaCourseId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [issuedBadgeId, setIssuedBadgeId] = useState<string | null>(null);

  const mineQuery = useMyBadges();
  const allQuery = useAllBadges();
  const issuedQuery = useBadgeIssued(issuedBadgeId);
  const createBadgeMutation = useCreateBadge();
  const criteriaMutation = useSetBadgeCriteria();
  const statusMutation = useSetBadgeStatus();

  const mine = mineQuery.data ?? [];
  const all = allQuery.data ?? [];
  const issuedList = issuedQuery.data ?? [];
  const loading = mineQuery.isPending || allQuery.isPending;
  const loadFailed = mineQuery.isError || allQuery.isError;
  const issuedError = issuedBadgeId !== null && issuedQuery.isError ? t('issuedLoadFailed') : null;

  const badgeName = (entry: MyBadgeView) =>
    entry.badge?.name ?? all.find((b) => b.id === entry.badgeId)?.name ?? t('badgeFallback', { id: entry.badgeId });

  function createBadge(event: FormEvent) {
    event.preventDefault();
    createBadgeMutation.mutate(name, {
      onSuccess: () => {
        setName('');
        setMessage(t('badgeCreated'));
      },
      onError: () => setMessage(t('badgeCreateFailed')),
    });
  }

  function setCriteria(event: FormEvent) {
    event.preventDefault();
    criteriaMutation.mutate(
      { badgeId: criteriaBadgeId, courseId: criteriaCourseId },
      {
        onSuccess: () => setMessage(t('criteriaSaved')),
        onError: () => setMessage(t('criteriaRefused')),
      },
    );
  }

  function activate(id: string) {
    statusMutation.mutate(
      { badgeId: id, status: 1 },
      {
        onSuccess: () => setMessage(t('badgeActivated')),
        onError: () => setMessage(t('badgeActivationRefused')),
      },
    );
  }

  function toggleIssued(badge: BadgeView) {
    setIssuedBadgeId((current) => (current === badge.id ? null : badge.id));
  }

  const issuedBadgeName = all.find((b) => b.id === issuedBadgeId)?.name ?? '';
  const issuedOpen = issuedBadgeId !== null && issuedQuery.data !== undefined;

  return (
    <PageShell width="medium">
      <PageHeader title={t('badgesHeading')} />
      {loadFailed ? (
        <>
          <ErrorAlert variant="destructive">
            {t('badgesLoadFailed')}
          </ErrorAlert>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void mineQuery.refetch();
                void allQuery.refetch();
              }}
            >
              {t('retry')}
            </Button>
          </div>
        </>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('myBadges')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PageSkeleton label={t('loading')} rows={['h-10 w-full', 'h-10 w-full']} />
          ) : (
            <>
              <ul className="space-y-2" aria-label={t('myBadgesLabel')}>
                {mine.map((i) => (
                  <li key={i.id} className="rounded border p-2">
                    <p className="font-medium">
                      {badgeName(i)}
                      {i.revoked ? ` ${t('revokedSuffix')}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('issuedLine', {
                        date: formatDate(i.dateIssued),
                        hash: i.uniqueHash.slice(0, 12),
                      })}
                      {i.dateExpire ? ` ${t('expiresSuffix', { date: formatDate(i.dateExpire) })}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
              {mine.length === 0 ? (
                <Empty className="p-6">
                  <EmptyHeader>
                    <EmptyTitle>{t('noBadgesYet')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      {canAdminister ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('badgeAdministration')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {message ? (
              <ErrorAlert>
                {message}
              </ErrorAlert>
            ) : null}
            <ul className="space-y-1" aria-label={t('allBadgesLabel')}>
              {all.map((b) => (
                <li key={b.id} className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span>{STATUS_LABEL[b.status] ?? b.status}</span>
                  {b.status === 0 ? (
                    <Button type="button" variant="outline" onClick={() => activate(b.id)}>
                      {t('activate')}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => toggleIssued(b)}>
                    {issuedBadgeId === b.id ? t('hideIssued') : t('viewIssued')}
                  </Button>
                </li>
              ))}
            </ul>
            {issuedError ? (
              <ErrorAlert variant="destructive">
                {issuedError}
              </ErrorAlert>
            ) : null}
            {issuedOpen ? (
              <div className="space-y-2">
                <p className="font-medium">{t('issuedListTitle', { name: issuedBadgeName })}</p>
                <ul className="space-y-1" aria-label={t('issuedListTitle', { name: issuedBadgeName })}>
                  {issuedList.map((i) => (
                    <li key={i.id} className="rounded border p-2 text-sm">
                      <p>
                        {t('issuedToLine', { userId: i.userId, date: formatDate(i.dateIssued) })}
                        {i.revoked ? ` ${t('revokedSuffix')}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('issuedLine', {
                          date: formatDate(i.dateIssued),
                          hash: i.uniqueHash.slice(0, 12),
                        })}
                      </p>
                    </li>
                  ))}
                  {issuedList.length === 0 ? <li>{t('noIssuedYet')}</li> : null}
                </ul>
              </div>
            ) : null}
            <form onSubmit={(e) => createBadge(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="badge-name">{t('badgeName')}</FieldLabel>
                  <Input id="badge-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit">{t('createBadge')}</Button>
                </div>
              </FieldGroup>
            </form>
            <form onSubmit={(e) => setCriteria(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="criteria-badge">{t('badgeId')}</FieldLabel>
                  <Input
                    id="criteria-badge"
                    value={criteriaBadgeId}
                    onChange={(e) => setCriteriaBadgeId(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="criteria-course">{t('criteriaCourseId')}</FieldLabel>
                  <Input
                    id="criteria-course"
                    value={criteriaCourseId}
                    onChange={(e) => setCriteriaCourseId(e.target.value)}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit">{t('setCriteriaAll')}</Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}

export default BadgesPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navBadges');
}
