import type { Route } from './+types/class-public';
import { useEffect, useRef, useState } from 'react';
import { classPublicViewSchema, type ClassPublicView } from '@giaokhoa/contracts';
import { Button, buttonVariants } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { Link, useLoaderData, useParams } from 'react-router';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { createClassFeePayment, fetchClassPublic, fetchPayment } from '../api/classes';
import type { ClassFeePaymentView } from '../types/classes';
import { queryKeys } from '../queries/keys';
import { fetchApiJsonForRequest } from '#lib/server-api';

export type ClassPublicSummary = Pick<
  ClassPublicView,
  | 'classId'
  | 'name'
  | 'code'
  | 'schoolYear'
  | 'description'
  | 'ownerName'
  | 'status'
  | 'feeCost'
  | 'feeCurrency'
  | 'feeEnabled'
>;

export interface ClassPublicLoaderData {
  classPublic: ClassPublicSummary | null;
}

export async function loader({
  params,
  request,
}: {
  params: { id?: string };
  request: Request;
}): Promise<ClassPublicLoaderData> {
  const classId = params.id ?? '';
  if (!classId) return { classPublic: null };
  const body = await fetchApiJsonForRequest(request, `/api/v1/classes/${classId}/public`);
  const parsed = classPublicViewSchema.safeParse(body);
  if (!parsed.success) return { classPublic: null };
  const view = parsed.data;
  return {
    classPublic: {
      classId: view.classId,
      name: view.name,
      code: view.code,
      schoolYear: view.schoolYear,
      description: view.description,
      ownerName: view.ownerName,
      status: view.status,
      feeCost: view.feeCost,
      feeCurrency: view.feeCurrency,
      feeEnabled: view.feeEnabled,
    },
  };
}

export function ClassPublicPage({ initialPublic }: { initialPublic?: ClassPublicSummary | null } = {}) {
  const { t, i18n } = useTranslation('app');
  const { id } = useParams<{ id: string }>();
  const classId = id ?? '';
  const queryClient = useQueryClient();
  const [payment, setPayment] = useState<ClassFeePaymentView | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const publicQuery = useQuery({
    queryKey: queryKeys.classPublic(classId),
    queryFn: () => fetchClassPublic(classId),
    enabled: Boolean(classId),
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.payment(payment?.id ?? ''),
    queryFn: () => fetchPayment(payment!.id),
    enabled: Boolean(payment),
    refetchInterval: (query) => ((query.state.data?.status ?? payment?.status) === 'pending' ? 3000 : false),
  });
  const livePayment = statusQuery.data ?? payment;
  const succeeded = livePayment?.status === 'succeeded';

  const buyMutation = useMutation({
    mutationFn: () => createClassFeePayment(classId),
    onSuccess: (created) => {
      setPayError(null);
      setPayment(created);
    },
    onError: () => setPayError(t('classPublicPayFailed')),
  });

  const refreshedPaymentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!succeeded || !publicQuery.data || publicQuery.data.isMember) return;
    if (!payment || refreshedPaymentRef.current === payment.id) return;
    refreshedPaymentRef.current = payment.id;
    void queryClient.invalidateQueries({ queryKey: queryKeys.classPublic(classId) });
  }, [succeeded, publicQuery.data, payment, queryClient, classId]);

  const pub = publicQuery.data;

  return (
    <PageShell width="narrow">
      <PageHeader
        title={pub?.name ?? initialPublic?.name ?? t('classPublicFeeLabel')}
        description={pub?.schoolYear ?? initialPublic?.schoolYear ?? undefined}
      />
      {publicQuery.isPending ? (
        initialPublic ? (
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-col gap-1 text-sm">
                <p className="text-muted-foreground">{t('classPublicOwner', { name: initialPublic.ownerName })}</p>
                {initialPublic.description ? <p>{initialPublic.description}</p> : null}
              </div>
              {initialPublic.feeEnabled ? (
                <p className="text-base">
                  {t('classPublicFeeLabel')}:{' '}
                  <strong>
                    {(initialPublic.feeCost ?? 0).toLocaleString(i18n.language)} {initialPublic.feeCurrency}
                  </strong>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Skeleton className="h-64 w-full" />
        )
      ) : publicQuery.isError || !pub ? (
        <ErrorAlert variant="destructive">
          {t('classPublicLoadFailed')}
        </ErrorAlert>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted-foreground">{t('classPublicOwner', { name: pub.ownerName })}</p>
              {pub.description ? <p>{pub.description}</p> : null}
            </div>

            {pub.isMember || succeeded ? (
              <div className="flex flex-col gap-3">
                <ErrorAlert>
                  {succeeded ? t('classPublicPaySucceeded') : t('classPublicMember')}
                </ErrorAlert>
                <div>
                  <Link className={buttonVariants()} to={`/classes/${pub.classId}`}>
                    {t('classPublicGoToClass')}
                  </Link>
                </div>
              </div>
            ) : pub.status === 'archived' ? (
              <ErrorAlert>
                {t('classPublicArchived')}
              </ErrorAlert>
            ) : !pub.feeEnabled ? (
              <p className="text-sm text-muted-foreground">{t('classPublicNoFee')}</p>
            ) : livePayment ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm">{t('classPublicScanHint')}</p>
                {livePayment.vietqrPayload ? (
                  <QRCodeSVG value={livePayment.vietqrPayload} size={220} role="img" aria-label="VietQR" />
                ) : null}
                {livePayment.paymentCode ? (
                  <p className="text-sm">
                    {t('classPublicPaymentCode')}: <strong>{livePayment.paymentCode}</strong>
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">{t('classPublicPayPending')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-base">
                  {t('classPublicFeeLabel')}:{' '}
                  <strong>
                    {(pub.feeCost ?? 0).toLocaleString(i18n.language)} {pub.feeCurrency}
                  </strong>
                </p>
                <p className="text-sm text-muted-foreground">{t('classPublicBuyHint')}</p>
                {payError ? (
                  <ErrorAlert variant="destructive">
                    {payError}
                  </ErrorAlert>
                ) : null}
                <div>
                  <Button type="button" disabled={buyMutation.isPending} onClick={() => buyMutation.mutate()}>
                    {t('classPublicBuy')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

export default function ClassPublicRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <ClassPublicPage initialPublic={loaderData?.classPublic ?? null} />;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta, titleMeta } from '#lib/route-meta';

export function meta({ loaderData }: Route.MetaArgs) {
  const summary = loaderData?.classPublic;
  if (!summary) return appKeyMeta('classPublicTitle');
  return [
    ...titleMeta(summary.name),
    ...(summary.description ? [{ name: 'description', content: summary.description }] : []),
  ];
}
